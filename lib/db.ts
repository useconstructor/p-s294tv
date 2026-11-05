import "server-only";
import { createClient } from "@libsql/client";
export const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
let ready: Promise<unknown> | undefined;
export function schema() {
  return (ready ??= db
    .batch(
      [
        `CREATE TABLE IF NOT EXISTS nube_sesiones (hash TEXT PRIMARY KEY, propietario TEXT NOT NULL UNIQUE, inicializada INTEGER NOT NULL DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS categorias (id TEXT NOT NULL, propietario TEXT NOT NULL, nombre TEXT NOT NULL, PRIMARY KEY(id,propietario))`,
        `CREATE TABLE IF NOT EXISTS productos (id TEXT PRIMARY KEY, propietario TEXT NOT NULL, nombre TEXT NOT NULL, categoria_id TEXT NOT NULL, stock INTEGER NOT NULL CHECK(stock>=0), precio_centimos INTEGER NOT NULL CHECK(precio_centimos>=0), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(categoria_id,propietario) REFERENCES categorias(id,propietario))`,
        `CREATE TABLE IF NOT EXISTS nube_operaciones (id TEXT PRIMARY KEY, propietario TEXT NOT NULL, clave TEXT NOT NULL, tipo TEXT NOT NULL, payload TEXT NOT NULL, resultado TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(propietario,clave))`,
        `CREATE INDEX IF NOT EXISTS productos_propietario_nombre ON productos(propietario,nombre COLLATE NOCASE)`,
        `CREATE INDEX IF NOT EXISTS productos_propietario_categoria ON productos(propietario,categoria_id)`,
        `CREATE INDEX IF NOT EXISTS categorias_propietario ON categorias(propietario)`,
        `CREATE INDEX IF NOT EXISTS operaciones_propietario_fecha ON nube_operaciones(propietario,created_at)`,
        // Additive constraints also protect the recovered schema without rewriting rows.
        ...["INSERT", "UPDATE"].map(
          (action) => `CREATE TRIGGER IF NOT EXISTS productos_integridad_${action.toLowerCase()}
            BEFORE ${action} ON productos
            WHEN typeof(NEW.stock) != 'integer' OR NEW.stock < 0 OR NEW.stock > 9007199254740991
              OR typeof(NEW.precio_centimos) != 'integer' OR NEW.precio_centimos < 0 OR NEW.precio_centimos > 9007199254740991
              OR typeof(NEW.version) != 'integer' OR NEW.version < 1 OR NEW.version > 9007199254740991
              OR length(trim(NEW.nombre)) < 1 OR length(trim(NEW.nombre)) > 120
              OR NOT EXISTS (SELECT 1 FROM categorias WHERE id=NEW.categoria_id AND propietario=NEW.propietario)
            BEGIN SELECT RAISE(ABORT, 'Invalid inventory product'); END`,
        ),
        ...["INSERT", "UPDATE"].map(
          (action) => `CREATE TRIGGER IF NOT EXISTS productos_limites_${action.toLowerCase()}
            BEFORE ${action} ON productos
            WHEN NEW.stock > 1000000 OR NEW.precio_centimos > 100000000
            BEGIN SELECT RAISE(ABORT, 'Inventory field exceeds its limit'); END`,
        ),
      ],
      "write",
    )
    .catch((e) => {
      ready = undefined;
      throw e;
    }));
}
