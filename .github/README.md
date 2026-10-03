# Hermes Mobile — development experiments

Community project exploring an independent native mobile client for Hermes Agent.
The name is provisional. This repository is not affiliated with or endorsed by Nous Research.

## Current scope

No mobile application or release is available yet. Published files are a reviewed subset of development experiments:

- bounded SSE parsing;
- authenticated metadata/session client;
- error presentation policy using translation keys;
- a disposable SQLite memory experiment.

Private planning notes, personal data, local receipts, screenshots and third-party branding assets are not part of this initial publication. No credentials are needed for the tests.

## macOS CI

The workflow uses a standard GitHub-hosted macOS runner with read-only repository permissions, pinned Actions and a bounded timeout. It runs portable tests and boots an available iOS simulator, capturing its home screen and environment receipt.

**Simulator boot is not an application test.** There is no Hermes Mobile binary installed on that simulator yet. This does not validate iPhone installation, signing, push, native storage, Cloud or SSH connectivity.

Tests, fixtures, runner scripts and CI artifacts are development-only. Future release packaging must exclude them. SQLite in the disposable Python experiment is not encrypted and is not a mobile runtime dependency.

## Run locally

```sh
node --test spikes/004-client-stream/sse.test.mjs spikes/004-client-stream/runner.test.mjs spikes/005-connection-client/client.test.mjs spikes/006-error-policy/presentation.test.mjs
python -B -m unittest discover -s spikes/007-local-memory -v
```

Python test scratch storage can be set through `HM_TEST_SCRATCH`; CI places it in the runner's temporary directory.

Licensing of the project and rights to any future brand assets remain to be decided before a software release. Public availability alone is not a license grant.
