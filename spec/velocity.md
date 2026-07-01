← [SPEC.md](../SPEC.md)

## Velocity Calculation Logic

```
velocity = AVG( sum of accepted points across the last velocity_window completed iterations )
```

- Stories with `story_type = 'chore'` or `'release'` are excluded from point counts
- `iterations.velocity` is finalized when an iteration transitions to `state = 'done'`
- Auto-assignment: stories are pulled from the top of the backlog to fill the next iteration up to the current velocity
