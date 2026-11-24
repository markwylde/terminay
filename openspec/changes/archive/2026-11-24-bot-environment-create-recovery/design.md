## Context

`BotEnvironmentService.create` sends `POST /containers/create?name=terminay-bot-<id>` through the socket driver (ADR-0092). Before it, `owned()` inspects the name and refuses a container that carries another owner's labels. On the reported machine `GET /containers/<name>/json` answered 404 while create answered 409: "the container name is already in use by … an external entity". `podman ps --external` listed the name with status `Storage`. A forced delete by name through the same API removed it, and create then succeeded.

`httpError` already maps 409 to the `conflict` code, but `botFailure` had no message for it, so the user saw the general engine text. Engine diagnostics are deliberately not passed through, so the message has to be curated.

In the client, `BotRecovery` rendered the create and recreate buttons as bare small buttons, and showed a failed attempt as a separate note. `OverviewView` labelled its primary action **Start** in every non-running state and disabled menu items without saying why.

## Goals / Non-Goals

**Goals:**
- A bot whose name is held by leftover storage is created without the user touching the engine.
- A user looking at a bot that needs its environment created sees why, and the action, in one place.

**Non-Goals:**
- Explaining why Podman left the storage behind, or cleaning up leftovers for names Terminay is not creating.
- Passing raw engine diagnostics to the client.

## Decisions

### Remove the leftover by its own identifier, never by name

On a `conflict` from container create, the service inspects the name again. If a container is listed, the conflict is rethrown: an owned container would have been found before create, and a foreign one must not be removed. Otherwise it asks the driver for the leftover under that name. The socket driver answers only for Podman, from `GET /libpod/containers/json?all=true&external=true` with a name filter: exactly one entry whose `Names` holds the exact name and whose `State` is `storage`. The service removes that identifier and creates once more. A second conflict is rethrown, so the retry cannot loop. No leftover, or a lookup that fails, rethrows the original conflict.

Removing by name was rejected. Another engine client could create a container with the bot's name between the inspect and the delete, and a delete by name would remove it without an ownership check. A delete by the leftover's identifier can only reach the leftover.

The lookup is a new optional `leftover` operation on `EngineDriver`, not a `run` vocabulary entry, because it is a libpod-only read with no Docker counterpart.

### The alert owns the action and the failure

The recovery strip sits above Chat and every Configure panel, so it is where a user who cannot start a session looks. The alert states the condition, the consequence and the action together. A failed attempt's reason appears inside the same alert, which stays until the state changes. Tone follows state: warning for not created or out of date, error for failed.

### Overview keeps one primary action and names it by outcome

The same lifecycle `start` call creates a missing container, so the button keeps its behaviour and changes only its label. The Actions menu adds **Create environment** when there is no container. **Restart** and **Recreate** stay listed, with the reason beneath them when they cannot run, so the menu's shape does not change between states.

## Risks / Trade-offs

- Podman's external listing was seen to take over 30 seconds on a machine with many build leftovers → the lookup runs only after a refused create, is bounded by the transport deadline, and a failure reports the original conflict.
- The alert and the Overview hero both offer create on Environment › Overview → accepted; both call the same action and the alert is the only one visible from Chat.
