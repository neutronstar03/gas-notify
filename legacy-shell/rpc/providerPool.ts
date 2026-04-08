import type { RpcEndpoint } from '../types'

export class ProviderPool {
  private wsIndex = 0
  private httpIndex = 0

  constructor(
    private readonly wsProviders: RpcEndpoint[],
    private readonly httpProviders: RpcEndpoint[],
  ) {}

  currentWs(): RpcEndpoint | undefined {
    return this.wsProviders[this.wsIndex]
  }

  currentHttp(): RpcEndpoint | undefined {
    return this.httpProviders[this.httpIndex]
  }

  rotateWs(): RpcEndpoint | undefined {
    if (this.wsProviders.length === 0) {
      return undefined
    }

    this.wsIndex = (this.wsIndex + 1) % this.wsProviders.length
    return this.currentWs()
  }

  rotateHttp(): RpcEndpoint | undefined {
    if (this.httpProviders.length === 0) {
      return undefined
    }

    this.httpIndex = (this.httpIndex + 1) % this.httpProviders.length
    return this.currentHttp()
  }

  wsProvidersList(): RpcEndpoint[] {
    return [...this.wsProviders]
  }

  httpProvidersList(): RpcEndpoint[] {
    return [...this.httpProviders]
  }
}
