## 1. Renderer

- [x] 1.1 Fetch Pixel's providers whenever Pixel is on, and again each time the balloon opens
- [x] 1.2 Build the install-help message and guide buttons in `pixelModel.ts`
- [x] 1.3 Show the help in the balloon and open the guide from its button

## 2. Built-in agents extension

- [x] 2.1 Do not cache a missing executable in the locator
- [x] 2.2 Make the `not_installed` detail name the install guide without repeating itself

## 3. Verification

- [x] 3.1 Unit: install help for a missing chosen agent and for onboarding with none installed
- [x] 3.2 Unit: an agent installed after a miss is found
- [x] 3.3 End-to-end: with Codex chosen and not installed, the balloon shows the help and "Install Codex"
- [ ] 3.4 Pull request checks green
