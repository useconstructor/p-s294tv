"use client";
export async function request(path: string, init?: RequestInit) {
  let r: Response;
  try {
    r = await fetch("/api/" + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(
      "No se pudo conectar con el inventario. Comprueba la conexión y reintenta.",
    );
  }
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error(
      "No se pudo confirmar la respuesta del servidor. Conserva los datos y reintenta.",
    );
  }
  if (!r.ok)
    throw Object.assign(new Error(data.error), { status: r.status, data });
  return data;
}
let session: Promise<void> | undefined;
export function ensureSession() {
  return (session ??= (async () => {
    const initialize = async () => {
      try {
        await request("sesion");
        try {
          localStorage.removeItem("nube_initialization");
        } catch {}
        return;
      } catch (e) {
        if ((e as { status?: number }).status !== 401) throw e;
      }
      let key: string;
      try {
        key =
          localStorage.getItem("nube_initialization") || crypto.randomUUID();
        localStorage.setItem("nube_initialization", key);
      } catch {
        throw Error(
          "El navegador bloquea el almacenamiento de sesión. Abre la aplicación directamente para continuar.",
        );
      }
      await request("sesion", {
        method: "POST",
        body: JSON.stringify({ initializationKey: key }),
      });
      try {
        await request("sesion");
      } catch {
        throw Error(
          "Las cookies están bloqueadas. Abre la aplicación directamente o reintenta. El contexto integrado puede tener una sesión distinta.",
        );
      }
      try {
        localStorage.removeItem("nube_initialization");
      } catch {}
    };
    if (navigator.locks)
      await navigator.locks.request("nube_session", initialize);
    else {
      try {
        await request("sesion");
      } catch {
        throw Error(
          "Este navegador no permite coordinar una sesión segura. Abre la aplicación en un navegador compatible.",
        );
      }
    }
  })().finally(() => {
    session = undefined;
  }));
}
export function trackConfirmed(id: string, tipo: string) {
  if (!["crear", "editar"].includes(tipo) || navigator.doNotTrack === "1")
    return;
  try {
    const key = "nube_analytics_" + id;
    if (localStorage.getItem(key)) return;
    const track = (
      window as unknown as { constructorTrack?: (s: string) => void }
    ).constructorTrack;
    if (track) {
      localStorage.setItem(key, "1");
      track(tipo === "crear" ? "producto_creado" : "producto_editado");
    }
  } catch {}
}
