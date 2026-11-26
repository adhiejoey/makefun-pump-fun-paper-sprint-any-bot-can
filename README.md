# Pump.fun Paper Sprint: Any Bot Can Win

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/adhiejoey/makefun-pump-fun-paper-sprint-any-bot-can/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/adhiejoey/makefun-pump-fun-paper-sprint-any-bot-can/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A deliberately simple momentum bot that paper-trades pump.fun on a 6-hour
replay: it watches each new coin's bonding-curve price, buys 0.02 SOL once a
coin has climbed 5% above the first price seen for it, holds at most five
coins at once, never buys the same mint twice, and sells a whole position at
+30%, at −20%, or after 6,000 slots so slots keep turning over across many
distinct coins. No network, no clock, no randomness — every order is a pure
function of the batch stream, so two runs on the same data are identical.

## How it works

`main.ts` (Node 22, standard library only) speaks the agent-fun/replay/v2
protocol over stdin/stdout: it reads the harness `hello`, then one `reply`
per `batch` with its `orders`, and exits on `done`. Run it with plain
`node main.ts`.

## License

MIT — see LICENSE.
