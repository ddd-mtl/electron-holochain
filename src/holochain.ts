import * as childProcess from 'child_process'
import { EventEmitter } from 'events'
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import * as split from 'split'
import {
  constructOptions,
  HolochainRunnerOptions,
  PathOptions,
} from './options'
import { defaultHolochainRunnerBinaryPath, defaultLairKeystoreBinaryPath } from './binaries'

type STATUS_EVENT = 'status'
const STATUS_EVENT = 'status'
type APP_PORT_EVENT = 'port'
const APP_PORT_EVENT = 'port'
export { STATUS_EVENT, APP_PORT_EVENT }

export declare interface StatusUpdates {
  on(event: STATUS_EVENT | APP_PORT_EVENT, listener: (status: StateSignal | string) => void): this
}

export class StatusUpdates extends EventEmitter {
  emitStatus(status: StateSignal): void {
    this.emit(STATUS_EVENT, status)
  }
  emitAppPort(port: string): void {
    this.emit(APP_PORT_EVENT, port)
  }
}

export enum StateSignal {
  IsFirstRun,
  IsNotFirstRun,
  CreatingKeys,
  RegisteringDna,
  InstallingApp,
  EnablingApp,
  AddingAppInterface,
  IsReady,
  // error states
  FailedToStart,
  Crashed,
}

function stdoutToStateSignal(string: string): StateSignal {
  switch (string) {
    case '0':
      return StateSignal.IsFirstRun
    case '1':
      return StateSignal.IsNotFirstRun
    // IsFirstRun events
    case '2':
      return StateSignal.CreatingKeys
    case '3':
      return StateSignal.RegisteringDna
    case '4':
      return StateSignal.InstallingApp
    case '5':
      return StateSignal.EnablingApp
    case '6':
      return StateSignal.AddingAppInterface
    // Done/Ready Event
    case '7':
      return StateSignal.IsReady
    default:
      return null
  }
}

export async function runHolochain(
  statusEmitter: StatusUpdates,
  options: HolochainRunnerOptions,
  pathOptions?: PathOptions
): Promise<childProcess.ChildProcessWithoutNullStreams[]> {
  const lairKeystoreBinaryPath = pathOptions
    ? pathOptions.lairKeystoreBinaryPath
    : defaultLairKeystoreBinaryPath
  const holochainRunnerBinaryPath = pathOptions
    ? pathOptions.holochainRunnerBinaryPath
    : defaultHolochainRunnerBinaryPath

  const lairHandle = childProcess.spawn(lairKeystoreBinaryPath, [
    '--lair-dir',
    options.keystorePath,
  ])
  lairHandle.stdout.on('error', (e) => {
    console.log(e)
  })
  lairHandle.stderr.on('data', (e) => {
    console.log(e.toString())
  })
  const optionsArray = constructOptions(options)
  const holochainHandle = childProcess.spawn(
    holochainRunnerBinaryPath,
    optionsArray
  )
  return new Promise<childProcess.ChildProcessWithoutNullStreams[]>(
    (resolve, reject) => {
      let isReady = false;
      let hasAppPort = false;
      // split divides up the stream line by line
      holochainHandle.stdout.pipe(split()).on('data', (line: string) => {
        console.debug("holochain > " + line)
        // Check for state signal
        const checkIfSignal = stdoutToStateSignal(line)
        if (checkIfSignal === StateSignal.IsReady) {
          isReady = true;
        }
        if (checkIfSignal !== null) {
          statusEmitter.emitStatus(checkIfSignal)
        }
        // Check for app port
        const appPort = parseForAppPort(line)
        if (appPort !== null) {
          statusEmitter.emitAppPort(appPort)
          hasAppPort = true;
        }
        // Resolve once everything has been emitted
        if (isReady && hasAppPort) {
          resolve([lairHandle, holochainHandle])
        }
      })
      holochainHandle.stdout.on('error', (e) => {
        console.error("holochain error > " + e)
        reject()
      })
      holochainHandle.stderr.on('data', (e) => {
        console.error("holochain error > " + e.toString())
        reject()
      })
    }
  )
}

function parseForAppPort(line:string): string | null {
  let regex = /APP_WS_PORT: ([0-9]*)/gm;
  let match = regex.exec(line);
  // console.log({match});
  if (match === undefined || match === null || match.length === 0) {
    return null;
  }
  return match[1];
}
