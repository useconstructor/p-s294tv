import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db";
import { validate, priceCents, type Draft } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
function publicProduct(r: Record<string, unknown>) {
  const { propietario, ...p } = r;
  void propietario;
  return p;
}
function trusted(req: NextRequest) {
  const origins = [
    process.env.APP_ORIGIN,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  ]
    .filter(Boolean)
    .map((x) => new URL(x!).origin);
  return origins.includes(req.headers.get("origin") || "");
}
async function owner(req: NextRequest) {
  const token = req.cookies.get("nube_sesion")?.value;
  if (!token) return null;
  const r = await db.execute({
    sql: "SELECT propietario FROM nube_sesiones WHERE hash=? AND inicializada=1",
    args: [hash(token)],
  });
  return r.rows[0]?.propietario as string | undefined;
}
async function readBody(req: NextRequest) {
  const body = await req.json();
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new SyntaxError("Expected an object");
  return body;
}
async function handle(req: NextRequest) {
  try {
    await schema();
    const path = req.nextUrl.pathname.replace("/api/", "");
    if (req.method === "POST" && !trusted(req))
      return json(
        { error: "El origen de esta solicitud no está autorizado." },
        403,
      );
    let o = await owner(req);
    if (path === "sesion") {
      if (req.method === "GET")
        return o
          ? json({ ok: true })
          : json(
              { error: "Inicia la sesión para consultar el inventario." },
              401,
            );
      if (o) return json({ ok: true });
      const b = await readBody(req);
      if (!/^[a-f0-9-]{36}$/i.test(b.initializationKey || ""))
        return json({ error: "Inicialización inválida." }, 400);
      if (!process.env.JWT_SECRET) throw Error("Session configuration missing");
      const token = createHmac("sha256", process.env.JWT_SECRET)
        .update(b.initializationKey)
        .digest("hex");
      const h = hash(token);
      const tx = await db.transaction("write");
      try {
        await tx.execute({
          sql: "INSERT OR IGNORE INTO nube_sesiones(hash,propietario) VALUES(?,?)",
          args: [h, randomUUID()],
        });
        const s = (
          await tx.execute({
            sql: "SELECT * FROM nube_sesiones WHERE hash=?",
            args: [h],
          })
        ).rows[0];
        o = String(s.propietario);
        if (!s.inicializada) {
          const cats = ["Herramientas", "Consumibles", "Repuestos"];
          const ids = cats.map(() => randomUUID());
          for (let i = 0; i < 3; i++)
            await tx.execute({
              sql: "INSERT INTO categorias(id,propietario,nombre) VALUES(?,?,?)",
              args: [ids[i], o, cats[i]],
            });
          const seeds: [string, number, number, number][] = [
            ["Martillo de carpintero", 0, 8, 1450],
            ["Destornillador plano", 0, 12, 590],
            ["Lija grano 120", 1, 40, 85],
            ["Cola para madera", 1, 6, 720],
            ["Rodamiento estándar", 2, 10, 480],
            ["Correa de transmisión", 2, 0, 1800],
          ];
          for (const [n, c, s, p] of seeds)
            await tx.execute({
              sql: "INSERT INTO productos VALUES(?,?,?,?,?,?,1,?,?)",
              args: [
                randomUUID(),
                o,
                n,
                ids[c],
                s,
                p,
                new Date().toISOString(),
                new Date().toISOString(),
              ],
            });
          await tx.execute({
            sql: "UPDATE nube_sesiones SET inicializada=1 WHERE hash=?",
            args: [h],
          });
        }
        await tx.commit();
      } finally {
        tx.close();
      }
      const r = json({ ok: true });
      const secure = new URL(process.env.APP_ORIGIN!).protocol === "https:";
      r.cookies.set("nube_sesion", token, {
        httpOnly: true,
        secure,
        sameSite: secure ? "none" : "lax",
        partitioned: secure,
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      return r;
    }
    if (!o)
      return json(
        {
          error:
            "No se pudo confirmar la sesión. Reintenta o abre la aplicación directamente.",
        },
        401,
      );
    if (req.method === "GET") {
      if (path === "categorias")
        return json({
          categorias: (
            await db.execute({
              sql: "SELECT id,nombre FROM categorias WHERE propietario=? ORDER BY nombre",
              args: [o],
            })
          ).rows,
        });
      if (path === "operaciones")
        return json({
          operaciones: (
            await db.execute({
              sql: "SELECT id,clave,tipo,payload,resultado,created_at FROM nube_operaciones WHERE propietario=? ORDER BY created_at DESC LIMIT 100",
              args: [o],
            })
          ).rows.map((r) => ({
            ...r,
            payload: JSON.parse(String(r.payload)),
            resultado: JSON.parse(String(r.resultado)),
          })),
        });
      if (path === "productos") {
        const q = req.nextUrl.searchParams;
        const args: (string | number)[] = [o];
        let where = "propietario=?";
        if (q.has("categoria") && q.get("categoria")) {
          const c = q.get("categoria")!;
          if (
            !(
              await db.execute({
                sql: "SELECT id FROM categorias WHERE propietario=? AND id=?",
                args: [o, c],
              })
            ).rows.length
          )
            return json(
              {
                error:
                  "La categoría del enlace no existe. Elige una categoría válida o Todas.",
                code: "INVALID_CATEGORY",
              },
              400,
            );
          where += " AND categoria_id=?";
          args.push(c);
        }
        if (q.get("sin_existencias") === "1") where += " AND stock=0";
        const rows = (
          await db.execute({
            sql: `SELECT * FROM productos WHERE ${where} ORDER BY nombre COLLATE NOCASE,id`,
            args,
          })
        ).rows;
        const total = (
          await db.execute({
            sql: "SELECT count(*) AS n FROM productos WHERE propietario=?",
            args: [o],
          })
        ).rows[0].n;
        return json({
          productos: rows
            .filter(
              (r) =>
                !q.get("q") ||
                String(r.nombre)
                  .toLocaleLowerCase("es-ES")
                  .includes(q.get("q")!.toLocaleLowerCase("es-ES")),
            )
            .map(publicProduct),
          total,
        });
      }
      if (path === "resumen" || path === "metricas") {
        const tx = await db.transaction("read");
        try {
          const products = (
            await tx.execute({
              sql: "SELECT categoria_id,stock,precio_centimos FROM productos WHERE propietario=?",
              args: [o],
            })
          ).rows;
          const categories = (
            await tx.execute({
              sql: "SELECT id,nombre FROM categorias WHERE propietario=? ORDER BY nombre",
              args: [o],
            })
          ).rows;
          let units = BigInt(0);
          let value = BigInt(0);
          let zero = 0;
          const totals = new Map<string, { productos: number; unidades: bigint; valor: bigint }>();
          for (const p of products) {
            const stock = BigInt(String(p.stock));
            units += stock;
            value += stock * BigInt(String(p.precio_centimos));
            if (stock === BigInt(0)) zero++;
            const id = String(p.categoria_id);
            const category = totals.get(id) || { productos: 0, unidades: BigInt(0), valor: BigInt(0) };
            category.productos++;
            category.unidades += stock;
            category.valor += stock * BigInt(String(p.precio_centimos));
            totals.set(id, category);
          }
          // Fields are safe integers; products and aggregates may exceed that range.
          const exact = (n: bigint) =>
            n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n.toString();
          await tx.commit();
          return json({
            productos: products.length,
            unidades: exact(units),
            sin_existencias: zero,
            valor_centimos: exact(value),
            categorias: categories.map((c) => ({
              ...c,
              productos: totals.get(String(c.id))?.productos || 0,
              unidades: exact(totals.get(String(c.id))?.unidades || BigInt(0)),
              valor_centimos: exact(totals.get(String(c.id))?.valor || BigInt(0)),
            })),
          });
        } finally {
          tx.close();
        }
      }
      return json({ error: "Recurso no encontrado." }, 404);
    }
    const tipo = path.replace("productos/", "");
    if (!["crear", "editar", "eliminar"].includes(tipo))
      return json({ error: "Acción no encontrada." }, 404);
    const b = await readBody(req);
    if (typeof b.clave !== "string" || !/^[a-f0-9-]{36}$/i.test(b.clave))
      return json({ error: "La clave del envío no es válida." }, 400);
    const keys =
      tipo === "eliminar"
        ? ["clave", "id", "version"]
        : tipo === "editar"
          ? [
              "clave",
              "id",
              "version",
              "nombre",
              "categoria_id",
              "stock",
              "precio",
            ]
          : ["clave", "nombre", "categoria_id", "stock", "precio"];
    if (Object.keys(b).some((k) => !keys.includes(k)))
      return json({ error: "El envío contiene campos no permitidos." }, 400);
    const payload = JSON.stringify(
      Object.fromEntries(keys.map((k) => [k, b[k]])),
    );
    const tx = await db.transaction("write");
    try {
      const previous = (
        await tx.execute({
          sql: "SELECT tipo,payload,resultado FROM nube_operaciones WHERE propietario=? AND clave=?",
          args: [o, b.clave],
        })
      ).rows[0];
      if (previous) {
        if (previous.tipo !== tipo || previous.payload !== payload)
          return json(
            {
              error: "Esta clave pertenece a otro envío.",
              code: "KEY_CONFLICT",
            },
            409,
          );
        return json(JSON.parse(String(previous.resultado)));
      }
      let old: Record<string, unknown> | undefined;
      if (tipo !== "crear") {
        if (typeof b.id !== "string" || !Number.isSafeInteger(b.version))
          return json({ error: "Producto o versión inválidos." }, 400);
        old = (
          await tx.execute({
            sql: "SELECT * FROM productos WHERE id=? AND propietario=?",
            args: [b.id, o],
          })
        ).rows[0];
        if (!old || old.version !== b.version)
          return json(
            {
              error: "Este producto ha cambiado. Revisa los valores actuales.",
              code: "VERSION_CONFLICT",
              actual: old ? publicProduct(old) : null,
            },
            409,
          );
      }
      if (tipo !== "eliminar") {
        const errors = validate(b as Draft);
        if (
          typeof b.categoria_id !== "string" ||
          !(
            await tx.execute({
              sql: "SELECT id FROM categorias WHERE id=? AND propietario=?",
              args: [String(b.categoria_id), o],
            })
          ).rows.length
        )
          errors.categoria_id = "Selecciona una categoría de este inventario.";
        if (Object.keys(errors).length)
          return json({ error: "Revisa los campos indicados.", errors }, 400);
        const cents = priceCents(b.precio);
        const now = new Date().toISOString();
        const id = b.id || randomUUID();
        if (tipo === "crear")
          await tx.execute({
            sql: "INSERT INTO productos VALUES(?,?,?,?,?,?,1,?,?)",
            args: [
              id,
              o,
              b.nombre.trim(),
              b.categoria_id,
              Number(b.stock),
              cents,
              now,
              now,
            ],
          });
        else
          await tx.execute({
            sql: "UPDATE productos SET nombre=?,categoria_id=?,stock=?,precio_centimos=?,version=version+1,updated_at=? WHERE id=? AND propietario=? AND version=?",
            args: [
              b.nombre.trim(),
              b.categoria_id,
              Number(b.stock),
              cents,
              now,
              id,
              o,
              b.version,
            ],
          });
        old = (
          await tx.execute({
            sql: "SELECT * FROM productos WHERE id=? AND propietario=?",
            args: [id, o],
          })
        ).rows[0];
      } else
        await tx.execute({
          sql: "DELETE FROM productos WHERE id=? AND propietario=? AND version=?",
          args: [b.id, o, b.version],
        });
      const id = randomUUID();
      const result = {
        ok: true,
        operacion: { id, tipo },
        producto: publicProduct(old!),
      };
      await tx.execute({
        sql: "INSERT INTO nube_operaciones VALUES(?,?,?,?,?,?,?)",
        args: [
          id,
          o,
          b.clave,
          tipo,
          payload,
          JSON.stringify(result),
          new Date().toISOString(),
        ],
      });
      await tx.commit();
      return json(result);
    } finally {
      tx.close();
    }
  } catch (e) {
    if (e instanceof SyntaxError)
      return json({ error: "El formato del envío no es válido." }, 400);
    console.error(
      "Inventory request failed",
      e instanceof Error ? e.message : "unknown",
    );
    return json(
      {
        error:
          "No se pudo completar la solicitud. Conserva los datos y reintenta.",
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
