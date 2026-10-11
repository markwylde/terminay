## Context

`applyProviderActivity` fenced an update whose provider or agent id differed
from the one the terminal already carried, and nothing ever cleared those
fields. The fence exists to keep a stale or foreign update from overwriting
the state of the agent that is running. It had no notion of that agent being
finished.

Measured on a running Desktop: with a second chat at work in a terminal, the
server reported that terminal's activity as idle.

## Goals / Non-Goals

- Goal: a terminal's activity follows the agent now running in it.
- Non-goal: showing two agents on one terminal. A terminal has one activity.

## Decisions

- **Takeover is allowed only from `done` or `idle`.** These are the states in
  which the holder has nothing left to report. Releasing the terminal when
  the holder's entry is removed was rejected: a finished chat's entry can
  remain while the next one starts, which is the common case.
- **The sequence fence is unchanged.** The agent service numbers updates per
  terminal, so a successor's sequence is always later than the holder's.

## Risks / Trade-offs

- [Two agents alive in one terminal, one idle] → the working one takes the
  terminal and the idle one is fenced until it finishes; the terminal shows
  the agent that is doing something.

## Migration Plan

None.

## Open Questions

None.
