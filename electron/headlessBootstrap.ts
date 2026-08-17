import { app } from 'electron';
import {
	applyHeadlessChromiumSwitches,
	darwinHasAquaSession,
	shouldUseHeadlessChromium,
} from './headlessLaunch';

if (shouldUseHeadlessChromium(process.platform, darwinHasAquaSession())) {
	applyHeadlessChromiumSwitches(app);
	process.stderr.write(
		'[Terminay] Chromium headless: this process is not in an Aqua session\n',
	);
}
