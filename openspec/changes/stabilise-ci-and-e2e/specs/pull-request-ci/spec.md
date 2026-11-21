## ADDED Requirements

### Requirement: A cold bot image build fits its limits

The real-container bot job SHALL allow a production bot image build with no reusable cache 20 minutes, and the job timeout and its watchdog SHALL both be 30 minutes so dependency installation, that build, and the real-container suites fit. A build that exceeds its limit SHALL still fail the job. Cold-build time SHALL remain in the run's execution-budget report.

#### Scenario: Bot image cache miss

- **WHEN** the bot image inputs change and no cached image exists
- **THEN** the full production image is built within the job's limits and the real-container suites run against it

#### Scenario: A hung bot image build

- **WHEN** a bot image build makes no progress
- **THEN** its 20-minute limit fails the job before the job timeout

### Requirement: Transient registry failures do not fail dependency installation

CI dependency installation SHALL retry transient npm registry failures three times with backoff between 2 and 10 seconds. The bound on `npm ci` SHALL be 300 seconds and the bound on the npm bootstrap SHALL be 120 seconds, so those retries can complete. A failure that persists through the retries, or an install that exceeds its bound, SHALL fail the job.

#### Scenario: Connection reset during install

- **WHEN** the registry resets a connection while CI installs dependencies
- **THEN** npm retries the download and the install continues

#### Scenario: The registry stays unavailable

- **WHEN** every retry of a download fails
- **THEN** the install exits non-zero and the job fails
