import assert from 'node:assert/strict';
import test from 'node:test';
import {
	groupLiveConnectionsByDevice,
	liveWindowsLabel,
} from './liveConnectionsByDevice.ts';

const connection = (connectionId: string, deviceId: string, deviceName: string) => ({
	attachedSessionCount: 1,
	connectionId,
	deviceId,
	deviceName,
});

test('a device with three windows is listed once, with a count of three', () => {
	const devices = groupLiveConnectionsByDevice([
		connection('c1', 'device-a', 'Studio Mac'),
		connection('c2', 'device-b', 'Phone'),
		connection('c3', 'device-a', 'Studio Mac'),
		connection('c4', 'device-a', 'Studio Mac'),
	]);
	assert.deepEqual(
		devices.map((device) => [device.deviceId, device.deviceName, device.windowCount]),
		[
			['device-a', 'Studio Mac', 3],
			['device-b', 'Phone', 1],
		],
	);
	// Devices keep the order they first connected in, and closing acts on one
	// of the device's own connections.
	assert.equal(devices[0]?.connectionId, 'c1');
	assert.equal(devices[0]?.attachedSessionCount, 3);
	assert.deepEqual(groupLiveConnectionsByDevice([]), []);
});

test('the window count is shown only when there is more than one', () => {
	assert.equal(liveWindowsLabel(1), '');
	assert.equal(liveWindowsLabel(2), '2 windows');
	assert.equal(liveWindowsLabel(8), '8 windows');
});
