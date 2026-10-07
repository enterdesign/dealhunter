# SimHub setup (draft)

SimHub talks to the board over USB serial using the **Custom Serial devices** plugin.
The board prints nothing back; SimHub only writes lines in the protocol from `firmware/src/protocol.h`.

1. SimHub -> Settings -> Plugins: enable *Custom Serial devices*.
2. Add a device, pick the board's COM port, 115200 baud.
3. Add an *update message* (JavaScript), roughly:

```js
'D;' + format($prop('DataCorePlugin.GameData.NewData.SpeedKmh'), '0') + ';' +
       format($prop('DataCorePlugin.GameData.NewData.Rpms'), '0') + ';' +
       format($prop('DataCorePlugin.GameData.NewData.CarSettings_MaxRPM'), '0') + ';' +
       $prop('DataCorePlugin.GameData.NewData.Gear') + ';' +
       format($prop('DataCorePlugin.GameData.NewData.Fuel') / $prop('DataCorePlugin.GameData.NewData.MaxFuel') * 100, '0') + ';' +
       $prop('DataCorePlugin.GameData.NewData.CurrentLap') + ';' +
       $prop('DataCorePlugin.GameData.NewData.PlayerLeaderboardPosition') + ';' +
       $prop('DataCorePlugin.GameData.NewData.OpponentsCount') + '\n'
```

**These property names are from memory and must be checked in SimHub's property explorer**
(they differ a bit between AC, ACC and iRacing). Standings lines (`S;idx;pos;name;gap`) are built the same way
from the opponent/leaderboard properties; send 8 rows at ~2 Hz.

Buttons on page 3 send plain keys (`firmware/src/buttons.h`); bind the same keys in each game
(AC/ACC controls menu, iRacing controls) or in SimHub's controls mapper.

Until the hardware arrives use `tools/simulator.py` instead of SimHub.
