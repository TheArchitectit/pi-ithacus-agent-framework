/**
 * plugins.ts — plugin registry pattern with lifecycle hooks.
 *
 * Plugins can inject context into agent spawn and hook into lifecycle events.
 * pi-agnostic: the registry is pure; the extension layer wires real hooks.
 */

import type { Plugin, PluginHook } from './types.js';

/** Plugin registry (one per session). */
export class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  /** hooks → plugins subscribed. */
  private hookMap = new Map<PluginHook, Plugin[]>();

  /** Register a plugin. */
  register(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin);
    for (const hook of plugin.hooks) {
      if (!this.hookMap.has(hook)) this.hookMap.set(hook, []);
      this.hookMap.get(hook)!.push(plugin);
    }
  }

  /** Unregister a plugin by id. */
  unregister(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    this.plugins.delete(id);
    for (const hook of plugin.hooks) {
      const arr = this.hookMap.get(hook);
      if (arr) this.hookMap.set(hook, arr.filter(p => p.id !== id));
    }
    return true;
  }

  /** List all plugins. */
  list(): Plugin[] {
    return [...this.plugins.values()];
  }

  /** Get plugins subscribed to a hook. */
  forHook(hook: PluginHook): Plugin[] {
    return this.hookMap.get(hook) ?? [];
  }

  /**
   * Inject context from all plugins subscribed to a hook. Returns the
   * concatenated context text (empty if no plugins).
   */
  injectContext(hook: PluginHook, ctx: { agentId: string; runId: string }): string {
    const plugins = this.forHook(hook);
    const parts: string[] = [];
    for (const p of plugins) {
      if (p.injectContext) {
        const text = p.injectContext({ ...ctx, hook });
        if (text) parts.push(text);
      }
    }
    return parts.join('\n\n');
  }

  /** Hook into agent spawn: returns context to prepend. */
  onAgentSpawn(agentId: string, runId: string): string {
    return this.injectContext('preSpawn', { agentId, runId });
  }

  /** Clear all plugins. */
  clear(): void {
    this.plugins.clear();
    this.hookMap.clear();
  }
}

/** Create a fresh plugin registry. */
export function createPluginRegistry(): PluginRegistry {
  return new PluginRegistry();
}
