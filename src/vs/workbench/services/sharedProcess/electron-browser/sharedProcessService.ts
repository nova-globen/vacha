/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client as MessagePortClient } from '../../../../base/parts/ipc/common/ipc.mp.js';
import { IChannel, IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event, Relay } from '../../../../base/common/event.js';
import { ISharedProcessService } from '../../../../platform/ipc/electron-browser/services.js';
import { SharedProcessChannelConnection, SharedProcessRawConnection } from '../../../../platform/sharedProcess/common/sharedProcess.js';
import { mark } from '../../../../base/common/performance.js';
import { Barrier, DeferredPromise, timeout } from '../../../../base/common/async.js';
import { acquirePort } from '../../../../base/parts/ipc/electron-browser/ipc.mp.js';

export class SharedProcessService extends Disposable implements ISharedProcessService {

	declare readonly _serviceBrand: undefined;

	// Tond: connecting is what SPAWNS the shared process. Nothing on a normal
	// boot needs it, so the connection is established on the first channel CALL
	// or raw connection instead of eagerly from the constructor. Event listens
	// and channel registrations queue up and attach if a call ever brings the
	// process up — events from a process that is not running cannot fire.
	private sharedProcessConnection: Promise<MessagePortClient> | undefined = undefined;
	private readonly whenConnected = new DeferredPromise<MessagePortClient>();

	private get withSharedProcessConnection(): Promise<MessagePortClient> {
		if (!this.sharedProcessConnection) {
			this.sharedProcessConnection = this.connect();
			this.sharedProcessConnection.then(connection => this.whenConnected.complete(connection));
		}

		return this.sharedProcessConnection;
	}

	private readonly restoredBarrier = new Barrier();

	constructor(
		readonly windowId: number,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	private async connect(): Promise<MessagePortClient> {
		this.logService.trace('Renderer->SharedProcess#connect');

		// Our performance tests show that a connection to the shared
		// process can have significant overhead to the startup time
		// of the window because the shared process could be created
		// as a result. As such, make sure we await the `Restored`
		// phase before making a connection attempt, but also add a
		// timeout to be safe against possible deadlocks.

		await Promise.race([this.restoredBarrier.wait(), timeout(2000)]);

		// Acquire a message port connected to the shared process
		mark('code/willConnectSharedProcess');
		this.logService.trace('Renderer->SharedProcess#connect: before acquirePort');
		const port = await acquirePort(SharedProcessChannelConnection.request, SharedProcessChannelConnection.response);
		mark('code/didConnectSharedProcess');
		this.logService.trace('Renderer->SharedProcess#connect: connection established');

		return this._register(new MessagePortClient(port, `window:${this.windowId}`));
	}

	notifyRestored(): void {
		if (!this.restoredBarrier.isOpen()) {
			this.restoredBarrier.open();
		}
	}

	getChannel(channelName: string): IChannel {
		const that = this;

		// Tond: deliberately not `getDelayedChannel(...)` because that would
		// require the connection promise up front. Only an actual call/listen
		// brings the shared process up.
		return {
			call<T>(command: string, arg?: unknown, cancellationToken?: CancellationToken): Promise<T> {
				return that.withSharedProcessConnection.then(connection => connection.getChannel(channelName).call<T>(command, arg, cancellationToken));
			},
			listen<T>(event: string, arg?: unknown): Event<T> {
				// listening must not spawn the process: subscribe for real only
				// once something else has connected
				const relay = new Relay<T>();
				that.whenConnected.p.then(connection => relay.input = connection.getChannel(channelName).listen<T>(event, arg));

				return relay.event;
			}
		};
	}

	registerChannel(channelName: string, channel: IServerChannel<string>): void {
		// same as `listen`: only the counterpart in the shared process could
		// call this channel, so registration can wait for a real connection
		this.whenConnected.p.then(connection => connection.registerChannel(channelName, channel));
	}

	async createRawConnection(): Promise<MessagePort> {

		// Await initialization of the shared process
		await this.withSharedProcessConnection;

		// Create a new port to the shared process
		this.logService.trace('Renderer->SharedProcess#createRawConnection: before acquirePort');
		const port = await acquirePort(SharedProcessRawConnection.request, SharedProcessRawConnection.response);
		this.logService.trace('Renderer->SharedProcess#createRawConnection: connection established');

		return port;
	}
}
