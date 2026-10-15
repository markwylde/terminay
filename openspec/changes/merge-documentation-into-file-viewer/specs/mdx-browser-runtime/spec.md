## MODIFIED Requirements

### Requirement: Navigation, link, form, and popup governance

The preview document SHALL NOT replace or navigate its top-level runtime away from the compiled document. Native form submission that would navigate SHALL be intercepted and blocked while JavaScript form handlers still run normally. `window.open`, popup creation, and creation of an ungoverned browser window SHALL be blocked. A project-relative link to an `.md` or `.mdx` document SHALL ask the host to open that document in the file viewer on the Document view after the server revalidates its project scope. Other project-relative resources SHALL remain inside the preview resource broker. HTTP and HTTPS links SHALL use Terminay's normal external-link policy rather than navigating the preview or application. Fragment navigation within the current rendered document SHALL remain available.

#### Scenario: Top-level navigation attempt

- **WHEN** the preview attempts to replace or navigate its top-level runtime
- **THEN** the navigation is blocked

#### Scenario: Native form submission

- **WHEN** a native form submission would navigate
- **THEN** it is intercepted and blocked while the JavaScript submit handler still runs

#### Scenario: Popup attempt

- **WHEN** the preview calls `window.open` or otherwise creates a popup or ungoverned browser window
- **THEN** the creation is blocked

#### Scenario: Project document link

- **WHEN** a user follows a project-relative link to an `.md` or `.mdx` document
- **THEN** the host is asked to open it on the Document view after the server revalidates its project scope

#### Scenario: External link

- **WHEN** a user follows an HTTP or HTTPS link
- **THEN** Terminay's normal external-link policy applies and neither the preview nor the application navigates

#### Scenario: Fragment navigation

- **WHEN** a link targets a fragment within the current rendered document
- **THEN** the fragment navigation works
