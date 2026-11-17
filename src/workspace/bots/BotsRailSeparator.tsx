/**
 * The left edge of the Bots rail: the shared pane separator, offered only
 * where the rail can be resized.
 */

import { PaneEdgeSeparator } from '../../components/PaneEdgeSeparator';
import { BOTS_RAIL_RESIZE_STEP } from './botsRailWidth';
import type { BotsRailWidth } from './useBotsRailWidth';

export function BotsRailSeparator({ rail }: Readonly<{ rail: BotsRailWidth }>) {
	if (!rail.resizable) return null;
	return (
		<PaneEdgeSeparator
			className="bots-rail__separator"
			label="Resize rail"
			step={BOTS_RAIL_RESIZE_STEP}
			data={{ 'data-bots-rail-separator': 'true' }}
			width={rail.drawn}
			min={rail.bounds.min}
			max={rail.bounds.max}
			onPreview={rail.setPreview}
			onCommit={rail.commit}
		/>
	);
}
