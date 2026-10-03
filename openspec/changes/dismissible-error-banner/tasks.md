## 1. Banner dismissal

- [x] 1.1 Add a dismiss button to the project error banner in `src/App.tsx`
      whose handler clears `errorText` and `featureFailureRef`. Verified by
      typecheck and by 2.1.
- [x] 1.2 Lay the banner out as message plus control in `src/App.css`. Verified
      by a visual check of a long notice wrapping beside the control.

## 2. Verification

- [x] 2.1 Extend `e2e/ai-tab-metadata.spec.ts` to dismiss the banner and assert
      it is gone, then that a later failure shows it again. Verified by
      `npm run test:e2e -- e2e/ai-tab-metadata.spec.ts` passing.
- [ ] 2.2 Run `npx openspec validate dismissible-error-banner --strict`,
      `npm run lint`, and `npm run typecheck`. Verified by all exiting zero.
- [ ] 2.3 Open the pull request and confirm every CI status is `success` or
      `skipped`. Verified by reading the statuses back from Gitea.
