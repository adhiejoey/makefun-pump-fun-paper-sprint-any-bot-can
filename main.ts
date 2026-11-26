// Pump.fun Paper Sprint — a deliberately simple momentum bot.
//
// Strategy in one paragraph: watch every new pump.fun coin's bonding-curve
// price (virtual SOL reserves divided by virtual token reserves). When a coin
// has climbed at least 5% above the first price we saw for it, and we have
// seen at least three trades in it, buy a small fixed slice (0.02 SOL, capped
// so the order stays well under 1% of the real SOL reserve). Hold at most five
// coins at once, never buy the same mint twice, and sell a whole position when
// it is up 30%, down 20%, or has been held for 6,000 slots, or when a
// CompleteEvent says the curve graduated, so slots keep turning over and the
// bot trades many distinct coins instead of sitting on a few. Everything is
// deterministic: every decision comes only from the events
// in the batch stream, so two runs on the same data produce identical orders.
//
// Wire protocol (agent-fun/replay/v2): the harness sends one JSON object per
// line on stdin — a "hello", then "batch" messages, then "done". We answer
// every batch with exactly one {"type":"reply","seq":N,"orders":[...]} line on
// stdout and exit quietly on "done" or on end of input. No network, no clock,
// no randomness, standard library only.

import { createInterface } from "node:readline";

// --- tunables (all in plain units; lamport amounts are BigInt strings) ---
const BUY_LAMPORTS = 20_000_000n; // 0.02 SOL per buy
const MIN_BUY_LAMPORTS = 12_000_000n; // never buy less than 0.012 SOL
const MAX_POSITIONS = 5;
const MAX_ORDERS_PER_BATCH = 16;
const SLIPPAGE_BPS = 500;
const RISE_NUM = 105; // buy once price >= first price * 105 / 100
const RISE_DEN = 100;
const MIN_TRADES_BEFORE_BUY = 3;
const TAKE_PROFIT_NUM = 130; // sell at +30%
const STOP_LOSS_NUM = 80; // sell at -20%
const MAX_HOLD_SLOTS = 6000;

// --- per-mint memory ---
interface CoinState {
  firstPrice: number; // SOL per token at first sight
  lastPrice: number; // SOL per token at latest sight
  trades: number; // TradeEvents observed
  realSol: bigint; // latest real SOL reserves
  buySlot: number; // slot we bought at (-1 if never bought)
  buyPrice: number; // price we bought at
  done: boolean; // already bought (and sold, or still held)
  complete: boolean; // a CompleteEvent arrived: curve graduated, exit
}

const coins = new Map<string, CoinState>();
let maxPositions = MAX_POSITIONS;
let cashLamports = 0n;

function priceOf(solReserves: string, tokenReserves: string): number {
  const sol = Number(solReserves);
  const tok = Number(tokenReserves);
  if (tok <= 0 || sol <= 0) return 0;
  return sol / tok;
}

function handleBatch(msg: any): { type: string; seq: number; orders: any[] } {
  const orders: any[] = [];
  const slot: number = msg.slot ?? 0;
  const events: any[] = Array.isArray(msg.events) ? msg.events : [];
  const account = msg.account ?? {};
  cashLamports = BigInt(account.cash_lamports ?? "0");
  const positions: any[] = Array.isArray(account.positions)
    ? account.positions
    : [];

  // Learn from this batch's trade events.
  for (const ev of events) {
    if (!ev || typeof ev.mint !== "string") continue;
    const mint: string = ev.mint;
    if (ev.event === "CompleteEvent") {
      const st = coins.get(mint);
      if (st) st.complete = true;
      continue;
    }
    if (ev.event !== "TradeEvent") continue;
    const p = priceOf(ev.virtual_sol_reserves, ev.virtual_token_reserves);
    if (p <= 0) continue;
    let st = coins.get(mint);
    if (!st) {
      st = {
        firstPrice: p,
        lastPrice: p,
        trades: 0,
        realSol: 0n,
        buySlot: -1,
        buyPrice: 0,
        done: false,
        complete: false,
      };
      coins.set(mint, st);
    }
    st.lastPrice = p;
    st.trades += 1;
    try {
      st.realSol = BigInt(ev.real_sol_reserves ?? "0");
    } catch {
      st.realSol = 0n;
    }
  }

  // Refresh marks too: they carry the freshest reserves for held coins.
  const marks: any[] = Array.isArray(msg.marks) ? msg.marks : [];
  for (const m of marks) {
    const st = coins.get(m.mint);
    if (!st) continue;
    const p = priceOf(m.virtual_quote_reserves, m.virtual_token_reserves);
    if (p > 0) st.lastPrice = p;
  }

  // Sells first: free slots before we consider new buys.
  let orderNo = 0;
  for (const pos of positions) {
    if (orders.length >= MAX_ORDERS_PER_BATCH) break;
    const st = coins.get(pos.mint);
    if (!st || st.buySlot < 0) continue; // not one of our buys
    const p = st.lastPrice;
    const heldSlots = slot - st.buySlot;
    const up = p * 100 >= st.buyPrice * TAKE_PROFIT_NUM;
    const down = p * 100 <= st.buyPrice * STOP_LOSS_NUM;
    const stale = heldSlots >= MAX_HOLD_SLOTS;
    const graduated = st.complete; // curve finished: exit, don't ride it out
    if (up || down || stale || graduated) {
      orders.push({
        side: "sell",
        client_id: `s${msg.seq}n${orderNo++}`,
        mint: pos.mint,
        token_amount: String(pos.token_amount),
        max_slippage_bps: SLIPPAGE_BPS,
      });
      st.done = true;
      st.buySlot = -1;
    }
  }

  // Buys: cheapest momentum first — scan coins in first-seen order so the
  // choice is stable and deterministic across runs.
  const openCount = positions.length;
  const sellsPlanned = orders.length;
  let room = maxPositions - openCount + sellsPlanned;
  if (room < 0) room = 0;
  for (const [mint, st] of coins) {
    if (orders.length >= MAX_ORDERS_PER_BATCH) break;
    if (room <= 0) break;
    if (st.done || st.buySlot >= 0) continue;
    if (st.trades < MIN_TRADES_BEFORE_BUY) continue;
    if (st.lastPrice * RISE_DEN < st.firstPrice * RISE_NUM) continue;
    // Size the buy: 0.02 SOL, but never more than 0.8% of the real reserve
    // (the harness caps orders at 1% of real reserve) and never under
    // 0.012 SOL, so every round trip clears the 0.01 SOL minimum.
    const reserveCap = (st.realSol * 80n) / 10000n;
    let size = BUY_LAMPORTS < reserveCap ? BUY_LAMPORTS : reserveCap;
    if (size < MIN_BUY_LAMPORTS) continue;
    if (cashLamports < size * 2n) continue;
    orders.push({
      side: "buy",
      client_id: `b${msg.seq}n${orderNo++}`,
      mint,
      quote_lamports: size.toString(),
      max_slippage_bps: SLIPPAGE_BPS,
    });
    st.buySlot = slot;
    st.buyPrice = st.lastPrice;
    cashLamports -= size;
    room -= 1;
  }

  return { type: "reply", seq: msg.seq, orders };
}

async function main(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      continue;
    }
    if (msg.type === "hello") {
      if (msg.caps && typeof msg.caps.max_open_positions === "number") {
        maxPositions = msg.caps.max_open_positions;
      }
      if (msg.capital && typeof msg.capital.lamports === "string") {
        try {
          cashLamports = BigInt(msg.capital.lamports);
        } catch {
          cashLamports = 0n;
        }
      }
      continue;
    }
    if (msg.type === "batch") {
      const reply = handleBatch(msg);
      process.stdout.write(JSON.stringify(reply) + "\n");
      continue;
    }
    if (msg.type === "done") {
      break;
    }
  }
}

main().catch(() => process.exit(1));
