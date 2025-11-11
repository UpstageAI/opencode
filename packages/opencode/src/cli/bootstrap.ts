import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      // Ensure we always dispose instance state, even on errors,
      // so the CLI does not hang due to lingering watchers/subscriptions.
      try {
        return await cb()
      } finally {
        await Instance.dispose()
      }
    },
  })
}
