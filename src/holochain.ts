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
import {
  defaultHolochainRunnerBinaryPath,
  defaultLairKeystoreBinaryPath,
} from './binaries'

type STATUS_EVENT = 'status'
const STATUS_EVENT = 'status'
type APP_PORT_EVENT = 'port'
const APP_PORT_EVENT = 'port'
type ERROR_EVENT = 'error'
const ERROR_EVENT = 'error'
type HOLOCHAIN_RUNNER_QUIT = 'holochain_runner_quit'
const HOLOCHAIN_RUNNER_QUIT = 'holochain_runner_quit'
type LAIR_KEYSTORE_QUIT = 'lair_keystore_quit'
const LAIR_KEYSTORE_QUIT = 'lair_keystore_quit'
export {
  STATUS_EVENT,
  APP_PORT_EVENT,
  ERROR_EVENT,
  LAIR_KEYSTORE_QUIT,
  HOLOCHAIN_RUNNER_QUIT,
}

export declare interface StatusUpdates {
  on(
    event:
      | STATUS_EVENT
      | APP_PORT_EVENT
      | ERROR_EVENT
      | LAIR_KEYSTORE_QUIT
      | HOLOCHAIN_RUNNER_QUIT,
    listener: (status: StateSignal | string | Error) => void
  ): this
}

export class StatusUpdates extends EventEmitter {
  emitStatus(status: StateSignal): void {
    this.emit(STATUS_EVENT, status)
  }
  emitAppPort(port: string): void {
    this.emit(APP_PORT_EVENT, port)
  }
  emitError(error: Error): void {
    this.emit(ERROR_EVENT, error)
  }
  emitHolochainRunnerQuit(): void {
    this.emit(HOLOCHAIN_RUNNER_QUIT)
  }
  emitLairKeystoreQuit(): void {
    this.emit(LAIR_KEYSTORE_QUIT)
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
): Promise<{
  lairHandle: childProcess.ChildProcessWithoutNullStreams
  holochainRunnerHandle: childProcess.ChildProcessWithoutNullStreams
}> {
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
    console.error(e)
  })
  lairHandle.stderr.on('data', (e) => {
    console.error(e.toString())
  })
  lairHandle.on('close', (code) => {
    console.log('lair keystore closed with code: ', code)
    statusEmitter.emitLairKeystoreQuit()
  })

  const optionsArray = constructOptions(options)
  const holochainRunnerHandle = childProcess.spawn(
    holochainRunnerBinaryPath,
    optionsArray
  )
  return new Promise<{
    lairHandle: childProcess.ChildProcessWithoutNullStreams
    holochainRunnerHandle: childProcess.ChildProcessWithoutNullStreams
  }>((resolve, _reject) => {
    let isReady = false
    let hasAppPort = false
    // split divides up the stream line by line
    holochainRunnerHandle.stdout.pipe(split()).on('data', (line: string) => {
      console.debug('holochain > ' + line)
      // Check for state signal
      const checkIfSignal = stdoutToStateSignal(line)
      if (checkIfSignal === StateSignal.IsReady) {
        isReady = true
      }
      if (checkIfSignal !== null) {
        statusEmitter.emitStatus(checkIfSignal)
      }
      // Check for app port
      const appPort = parseForAppPort(line)
      if (appPort !== null) {
        statusEmitter.emitAppPort(appPort)
        hasAppPort = true
      }
      // Resolve once everything has been emitted
      if (isReady && hasAppPort) {
        resolve({ lairHandle, holochainRunnerHandle })
      }
    })
    holochainRunnerHandle.stdout.on('error', (e) => {
      console.error('holochain stdout err > ' + e)
      statusEmitter.emitError(e)
    })
    holochainRunnerHandle.stderr.on('data', (e) => {
      console.error('holochain stderr err > ' + e.toString())
      statusEmitter.emitError(new Error(e.toString()))
    })
    holochainRunnerHandle.on('close', (code) => {
      console.log('holochain runner closed with code: ', code)
      statusEmitter.emitHolochainRunnerQuit()
    })
  })
}

function parseForAppPort(line: string): string | null {
  let regex = /APP_WS_PORT: ([0-9]*)/gm
  let match = regex.exec(line)
  // console.log({match});
  if (match === undefined || match === null || match.length === 0) {
    return null
  }
  return match[1]
}
