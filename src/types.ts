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
  detect(): Promise<HostPresence>;
  writeMcpConfig(oauth: OAuthConfig): Promise<void>;
  writeSkill(): Promise<void>;
  writeHooks(): Promise<void>;
  removeAll(): Promise<void>;
}
