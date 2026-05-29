/**
 * Service Container — dependency injection without a framework.
 *
 * Usage:
 *   container.set('notifications', notificationService);   // register
 *   container.get('notifications').send(...);               // consume
 *   container.has('notifications');                         // guard
 *
 * In tests, call container.set('notifications', mockService) before importing
 * code that uses the container — no globals to patch.
 */
class Container {
  #services = new Map();

  /** Register an already-constructed instance. */
  set(name, instance) {
    this.#services.set(name, instance);
    return this;
  }

  /**
   * Retrieve a service.
   * Throws a clear error if it was never registered — fail fast > silent null.
   */
  get(name) {
    if (!this.#services.has(name)) {
      throw new Error(
        `[Container] Service "${name}" not registered. ` +
        'Make sure it is registered during server startup before it is used.'
      );
    }
    return this.#services.get(name);
  }

  /** Safe check — use before calling get() in optional paths. */
  has(name) {
    return this.#services.has(name);
  }

  /** Remove a service (useful in tests to reset between suites). */
  unset(name) {
    this.#services.delete(name);
    return this;
  }

  /** Remove all services (test teardown). */
  reset() {
    this.#services.clear();
    return this;
  }
}

// Singleton exported to the entire application.
export const container = new Container();
