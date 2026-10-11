type Listener<T> = (payload: T) => void;

/**
 * Bus de eventos tipado. `E` mapea nombre de evento -> payload.
 * Los sistemas se comunican por aquí en lugar de referenciarse entre sí.
 */
export class EventBus<E extends object> {
  // Set<Listener<any>> porque cada clave guarda listeners de un payload distinto;
  // la seguridad de tipos la garantizan las firmas de on/emit.
  private readonly listeners = new Map<keyof E, Set<Listener<any>>>();

  /** Suscribe un listener. Devuelve una función para desuscribirse. */
  on<K extends keyof E>(type: K, listener: Listener<E[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => this.off(type, listener);
  }

  /** Suscribe un listener que se elimina tras la primera emisión. */
  once<K extends keyof E>(type: K, listener: Listener<E[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof E>(type: K, listener: Listener<E[K]>): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    // Copia: un listener puede (des)suscribirse durante la emisión.
    for (const listener of [...set]) listener(payload);
  }

  listenerCount(type: keyof E): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
