export interface OAuthConfig {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
}

export interface HostPresence {
  installed: boolean;
  configPath?: string;
}

export interface HostAdapter {
  id: string;
  displayName: string;
  capabilities: { mcpPrompts: boolean; hooks: boolean };
  /** Printed after install if present - use for host-specific next steps. */
  postInstallNote?: string;
  detect(): Promise<HostPresence>;
  writeMcpConfig(oauth: OAuthConfig): Promise<void>;
  writeSkill(): Promise<void>;
  writeHooks(): Promise<void>;
  removeAll(): Promise<void>;
}
