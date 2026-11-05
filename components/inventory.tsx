"use client";
/* Effects synchronize external URL/session state and expose request loading immediately. */
/* eslint-disable react-hooks/set-state-in-effect */
/* Canonical SVG and owner-uploaded brand URLs must load directly. */
/* eslint-disable @next/next/no-img-element */
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LayoutDashboard,
  Package,
  Plus,
  ArrowRight,
  Search,
  Check,
  AlertTriangle,
  X,
  ChevronDown,
  Clock3,
} from "lucide-react";
import branding from "@/branding.json";
import { Button } from "@/components/ui/button";
import { request, ensureSession, trackConfirmed } from "@/lib/client";
import {
  validate,
  draftOf,
  euro,
  number,
  type Product,
  type Category,
  type Draft,
} from "@/lib/validation";
type Metrics = {
  productos: number;
  unidades: number | string;
  sin_existencias: number;
  valor_centimos: number | string;
  categorias: (Category & { productos: number; unidades: number | string; valor_centimos: number | string })[];
};
type Operation = {
  tipo: string;
  payload: Record<string, unknown>;
  name: string;
};
type Editor = { kind: "crear" | "editar" | "eliminar"; product?: Product };
const blank: Draft = { nombre: "", categoria_id: "", stock: "0", precio: "" };
const fieldInstructions: Record<string, string> = {
  nombre: "Nombre",
  categoria_id: "Categoría",
  stock: "Stock",
  precio: "Precio unitario",
};

function ConflictComparison({
  draft,
  previous,
  current,
  catName,
  children,
  renderField,
  deletion = false,
}: {
  draft: Draft;
  previous?: Product;
  current?: Product | null;
  catName: (id: string) => string;
  children?: ReactNode;
  renderField?: (key: keyof Draft) => ReactNode;
  deletion?: boolean;
}) {
  const snapshots = deletion ? [
    { label: "Registro seleccionado", value: previous ? draftOf(previous) : null },
    { label: "Datos actuales", value: current ? draftOf(current) : null },
  ] : [
    { label: "Tu borrador", value: draft },
    { label: "Último confirmado", value: previous ? draftOf(previous) : null },
    { label: "Datos actuales", value: current ? draftOf(current) : null },
  ];
  const fields: { key: keyof Draft; label: string }[] = [
    { key: "nombre", label: "Nombre" },
    { key: "categoria_id", label: "Categoría" },
    { key: "stock", label: "Stock" },
    { key: "precio", label: "Precio unitario" },
  ];
  const changed = (key: keyof Draft) =>
    new Set(snapshots.map(({ value }) => value?.[key])).size > 1;
  const table = (items: typeof fields, label: string, editable = false) => (
    <div className="comparison-table" data-deletion={deletion || undefined} role="table" aria-label={label}>
      <div className="comparison-head" role="row">
        <span role="columnheader">Campo</span>
        {snapshots.map(({ label }) => (
          <span role="columnheader" key={label}>{label}</span>
        ))}
      </div>
      {items.map(({ key, label }) => {
        return (
          <div role="rowgroup" key={key}>
          <div className="comparison-row" role="row" data-field={key} data-changed={changed(key) || undefined}>
            <strong role="rowheader">{label}</strong>
            {snapshots.map(({ label: source, value }) => {
              const display = value
                ? key === "categoria_id"
                  ? catName(value[key])
                  : key === "precio"
                    ? `${value[key]} €`
                    : value[key]
                : "Ya no existe";
              return (
                <div role="cell" key={source}>
                  <span className="comparison-source" aria-hidden="true">{source}</span>
                  <span className="comparison-value">
                    <span className="sr-only">{label}: {display}</span>
                    <span aria-hidden="true">{display}</span>
                  </span>
                </div>
              );
            })}
          </div>
          {editable && renderField && (
            <div role="row" className="comparison-edit">
              <div role="cell" aria-colspan={snapshots.length + 1} className="conflict-input">{renderField(key)}</div>
            </div>
          )}
          </div>
        );
      })}
    </div>
  );
  const changedFields = fields.filter(({ key }) => changed(key));
  const unchanged = fields.filter(({ key }) => !changed(key));
  return (
    <div className="comparison">
      {unchanged.length > 0 && (
        <details className="unchanged-comparison">
          <summary>Ver campos sin cambios ({unchanged.length})</summary>
          {table(unchanged, "Comparación de campos sin cambios", true)}
        </details>
      )}
      {table(changedFields, "Comparación de cambios", true)}
      {children}
    </div>
  );
}
export default function Inventory({
  page,
}: {
  page: "dashboard" | "products";
}) {
  const router = useRouter();
  const [params, setParams] = useState("");
  const [search, setSearch] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState<number>();
  const [metrics, setMetrics] = useState<Metrics>();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invalidCategory, setInvalidCategory] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(true);
  const [editor, setEditor] = useState<Editor>();
  const [draft, setDraft] = useState<Draft>(blank);
  const [initial, setInitial] = useState<Draft>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState("draft");
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState<Product>();
  const [confirmation, setConfirmation] = useState<{ id: string; name: string; title: string; operation: string; visible: boolean }>();
  const [conflict, setConflict] = useState<Product | null>();
  const [operation, setOperation] = useState<Operation>();
  const [unresolved, setUnresolved] = useState<Operation[]>([]);
  const [discard, setDiscard] = useState(false);
  const [destination, setDestination] = useState<string>();
  const [editorOverflow, setEditorOverflow] = useState(false);
  const [panelNode, setPanelNode] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const confirmedFocus = useRef<string | null>(null);
  const url = new URLSearchParams(params);
  const category = url.get("categoria") || "";
  const zero = url.get("sin_existencias") === "1";
  const dirty =
    editor &&
    JSON.stringify(initial) !== JSON.stringify(draft) &&
    state !== "success";
  useEffect(() => {
    if (!editor) return;
    const panel = panelNode;
    if (!panel) return;
    const update = () => {
      const cue = panel.querySelector<HTMLElement>(".scroll-cue");
      const cueHeight = cue && !cue.hidden
        ? cue.offsetHeight + parseFloat(getComputedStyle(cue.parentElement!).rowGap)
        : 0;
      setEditorOverflow(panel.scrollHeight - cueHeight - panel.clientHeight - panel.scrollTop > 1);
    };
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    if (panel.firstElementChild) observer.observe(panel.firstElementChild);
    panel.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      panel.removeEventListener("scroll", update);
    };
  }, [editor, panelNode]);
  const updateURL = useCallback(
    (patch: Record<string, string | null>, replace = false) => {
      const u = new URL(window.location.href);
      for (const [k, v] of Object.entries(patch)) {
        if (v) u.searchParams.set(k, v);
        else u.searchParams.delete(k);
      }
      window.history[replace ? "replaceState" : "pushState"](
        {},
        "",
        u.pathname + u.search,
      );
      setParams(u.searchParams.toString());
    },
    [],
  );
  useEffect(() => {
    const sync = () => {
      setParams(new URLSearchParams(location.search).toString());
      setSearch(new URLSearchParams(location.search).get("q") || "");
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== (new URLSearchParams(params).get("q") || ""))
        updateURL({ q: search || null });
    }, 250);
    return () => clearTimeout(t);
  }, [search, params, updateURL]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    ensureSession()
      .then(() => request("categorias"))
      .then((d) => {
        if (active) {
          setCats(d.categorias);
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setInvalidCategory(false);
    request(page === "dashboard" ? "resumen" : "productos?" + params, {
      signal: controller.signal,
    })
      .then((d) => {
        if (!active) return;
        if (page === "dashboard") setMetrics(d);
        else {
          setProducts(d.productos);
          setTotal(d.total);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (active && e.name !== "AbortError") {
          setError(e.message);
          setInvalidCategory(e.data?.code === "INVALID_CATEGORY");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [ready, page, params, refresh]);
  const open = useCallback(
    (kind: Editor["kind"], product?: Product, activator?: HTMLElement) => {
      trigger.current =
        activator ||
        (document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
          ? document.activeElement
          : null);
      setEditor({ kind, product });
      confirmedFocus.current = null;
      const d = product ? draftOf(product) : { ...blank, categoria_id: "" };
      setDraft(d);
      setInitial(d);
      setErrors({});
      setState("draft");
      setMessage("");
      setConfirmed(undefined);
      setConfirmation(undefined);
      setConflict(undefined);
      setOperation(undefined);
    },
    [],
  );
  useEffect(() => {
    if (
      page === "products" &&
      new URLSearchParams(params).get("crear") === "1" &&
      !editor
    )
      open("crear");
  }, [params, page, editor, open]);
  useEffect(() => {
    if (!ready || page !== "products") return;
    let active = true;
    try {
      const ops: Operation[] = JSON.parse(
        sessionStorage.getItem("nube_pending") || "[]",
      );
      setUnresolved(ops);
      // The owned journal restores the original committed payload after reload;
      // recovery still replays that immutable submission before showing success.
      if (ops.length) {
        request("operaciones")
          .then(
            (journal: {
              operaciones: {
                clave: string;
                tipo: string;
                payload: Record<string, unknown>;
                resultado: { producto: Product };
              }[];
            }) => {
              if (!active) return;
              setUnresolved(
                ops.map((op) => {
                  const saved = journal.operaciones.find(
                    (item) =>
                      item.clave === op.payload.clave && item.tipo === op.tipo,
                  );
                  return saved
                    ? {
                        ...op,
                        payload: saved.payload,
                        name: saved.resultado.producto.nombre,
                      }
                    : op;
                }),
              );
            },
          )
          .catch(() => {
            /* The frozen browser intent remains recoverable. */
          });
      }
    } catch {}
    return () => {
      active = false;
    };
  }, [ready, page]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty || state === "pending" || state === "uncertain") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, state]);
  useEffect(() => {
    if (!editor) return;
    const editorURL = location.pathname + location.search;
    const protectHistory = (event: PopStateEvent) => {
      if (
        dirty ||
        state === "pending" ||
        state === "uncertain" ||
        state === "new-choice"
      ) {
        const attempted = location.pathname + location.search;
        event.stopImmediatePropagation();
        history.pushState(null, "", editorURL);
        if (state !== "pending") {
          setDestination(attempted);
          setDiscard(true);
        }
      } else {
        setEditor(undefined);
        setTimeout(
          () => trigger.current?.isConnected && trigger.current.focus(),
          0,
        );
      }
    };
    window.addEventListener("popstate", protectHistory, true);
    return () => window.removeEventListener("popstate", protectHistory, true);
  }, [editor, dirty, state]);
  function finishClose() {
    restoreFocus.current = true;
    setEditor(undefined);
    setDiscard(false);
    setDestination(undefined);
    if (url.has("crear")) updateURL({ crear: null }, true);
  }
  useEffect(() => {
    if (editor || !restoreFocus.current) return;
    const frame = requestAnimationFrame(() => {
      const row = confirmedFocus.current
        ? document.querySelector<HTMLElement>(`tr[data-product-id="${confirmedFocus.current}"]`)
        : null;
      const target = row?.querySelector<HTMLElement>("button") ||
        (trigger.current?.isConnected ? trigger.current : document.querySelector<HTMLElement>("[data-new-product]"));
      if (row) row.scrollIntoView({ block: "nearest", behavior: "instant" });
      target?.focus({ preventScroll: !!row });
      restoreFocus.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [editor]);
  function close() {
    if (state === "pending") return;
    if (dirty || state === "uncertain" || state === "new-choice") {
      setDiscard(true);
      return;
    }
    finishClose();
  }
  function nav(e: React.MouseEvent, href: string) {
    if (editor) {
      e.preventDefault();
      setDestination(href);
      setDiscard(true);
    }
  }
  function keepPending(op: Operation, remove = false) {
    setUnresolved((previous) => {
      const next = remove
        ? previous.filter((x) => x.payload.clave !== op.payload.clave)
        : [...previous.filter((x) => x.payload.clave !== op.payload.clave), op];
      try {
        sessionStorage.setItem("nube_pending", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  function focusValidationField(key: string) {
    requestAnimationFrame(() => {
      const field = document.getElementById("field-" + key);
      const panel = field?.closest(".editor-panel");
      if (panel) panel.scrollTop = 0;
      field?.focus({ preventScroll: true });
      if (
        field &&
        panel &&
        field.getBoundingClientRect().bottom >
          panel.getBoundingClientRect().bottom
      ) {
        field.scrollIntoView({ block: "nearest" });
      }
    });
  }
  useEffect(() => {
    if (!editor || !["pending", "uncertain", "conflict", "success"].includes(state))
      return;
    const frame = requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>(".editor-panel");
      // Focus the visible recovery context when the form becomes unavailable.
      if (panel) panel.scrollTop = 0;
      const target = state === "uncertain" ? "[data-recover-result]"
        : state === "conflict" ? ".conflict-heading" : ".editor-heading";
      panel?.querySelector<HTMLElement>(target)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [state, editor]);
  async function send(op: Operation) {
    setOperation(op);
    setState("pending");
    setMessage("Enviando. Espera la confirmación.");
    keepPending(op);
    try {
      const result = await request("productos/" + op.tipo, {
        method: "POST",
        body: JSON.stringify(op.payload),
      });
      setConfirmed(result.producto);
      setState("success");
      const title = op.tipo === "crear" ? "Producto creado" : op.tipo === "editar" ? "Producto actualizado" : "Producto eliminado";
      const saved: Product = result.producto;
      const matches = op.tipo !== "eliminar" &&
        (!category || saved.categoria_id === category) &&
        (!zero || saved.stock === 0) &&
        (!search || saved.nombre.toLocaleLowerCase("es-ES").includes(search.toLocaleLowerCase("es-ES")));
      setProducts((previous) => {
        const next = previous.filter((p) => p.id !== saved.id);
        if (matches) next.push(saved);
        return next.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      });
      setConfirmation({ id: saved.id, name: saved.nombre, title, operation: result.operacion.id, visible: matches });
      setMessage(
        op.tipo === "crear"
          ? "Producto creado"
          : op.tipo === "editar"
            ? "Producto actualizado"
            : "Producto eliminado",
      );
      keepPending(op, true);
      trackConfirmed(result.operacion.id, op.tipo);
      setRefresh((v) => v + 1);
      const removedIndex = products.findIndex((p) => p.id === saved.id);
      const neighbor = products[removedIndex + 1] || products[removedIndex - 1];
      confirmedFocus.current = matches ? saved.id
        : op.tipo === "eliminar" && removedIndex >= 0 ? neighbor?.id || null : null;
      finishClose();
    } catch (e) {
      const err = e as Error & {
        status?: number;
        data?: {
          errors?: Record<string, string>;
          code?: string;
          actual?: Product | null;
        };
      };
      if (err.status && err.status < 500) {
        keepPending(op, true);
        setOperation(undefined);
        if (err.status === 409 && err.data?.code === "VERSION_CONFLICT") {
          setConflict(err.data.actual ?? null);
          setState("conflict");
          setMessage(err.message);
        } else {
          setState("draft");
          setErrors(err.data?.errors || {});
          setMessage(err.message);
          if (err.status === 401) {
            setReady(false);
            setError(err.message);
            setRefresh((v) => v + 1);
          }
          const first = Object.keys(err.data?.errors || {})[0];
          if (first) focusValidationField(first);
        }
      } else {
        setState("uncertain");
        setMessage(
          "El envío podría haberse aplicado. Recupera el resultado antes de volver a guardar.",
        );
      }
    }
  }
  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (
      !editor ||
      state === "pending" ||
      state === "uncertain" ||
      state === "new-choice" ||
      state === "conflict"
    )
      return;
    const v = editor.kind === "eliminar" ? {} : validate(draft);
    setErrors(v);
    if (Object.keys(v).length) {
      setMessage("Revisa los campos indicados.");
      focusValidationField(Object.keys(v)[0]);
      return;
    }
    const payload: Record<string, unknown> = {
      clave: crypto.randomUUID(),
      ...(editor.kind === "eliminar" ? {} : draft),
      ...(editor.product
        ? { id: editor.product.id, version: editor.product.version }
        : {}),
    };
    void send({
      tipo: editor.kind,
      payload,
      name: editor.product?.nombre || draft.nombre,
    });
  }
  function recover(op: Operation) {
    open(
      op.tipo as Editor["kind"],
      op.tipo === "crear"
        ? undefined
        : products.find((p) => p.id === op.payload.id),
    );
    const d = {
      nombre: String(op.payload.nombre || op.name),
      categoria_id: String(op.payload.categoria_id || ""),
      stock: String(op.payload.stock || "0"),
      precio: String(op.payload.precio || ""),
    };
    setDraft(d);
    setInitial(d);
    setOperation(op);
    void send(op);
  }
  const catName = (id: string) =>
    cats.find((c) => c.id === id)?.nombre || "Categoría no disponible";
  const name = editor?.product?.nombre || operation?.name || "Crear producto";
  const resultCount = search || category || zero
    ? `${products.length} ${products.length === 1 ? "producto encontrado" : "productos encontrados"} de ${total ?? "…"}`
    : "Todos los productos";
  const priceGuidanceVisible = state !== "pending" && state !== "uncertain" && state !== "new-choice";
  const renderField = (key: keyof Draft, showPriceHint = true) => (
    <div className="field">
      <label htmlFor={"field-" + key}>{key === "precio" ? "Precio unitario (€)" : fieldInstructions[key]}</label>
      {key === "categoria_id" ? (
        <select
          id={"field-" + key}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? "error-" + key : undefined}
        >
          <option value="">Selecciona una categoría</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      ) : (
        <input
          id={"field-" + key}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          inputMode={key === "stock" ? "numeric" : key === "precio" ? "decimal" : undefined}
          aria-invalid={!!errors[key]}
          aria-describedby={[errors[key] ? "error-" + key : "", key === "precio" && priceGuidanceVisible ? "hint-precio" : ""].filter(Boolean).join(" ") || undefined}
          autoComplete={key === "nombre" ? "off" : undefined}
          placeholder={key === "nombre" ? "Nombre del producto" : key === "precio" ? "0,00" : undefined}
        />
      )}
      {errors[key] && <span id={"error-" + key} className="field-error">{errors[key]}</span>}
      {key === "precio" && showPriceHint && priceGuidanceVisible && <p id="hint-precio" className="field-hint">Precio: usa coma o punto decimal.</p>}
    </div>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <Link href="/" className="brand" onClick={(e) => nav(e, "/")}>
            <img
              data-brand-logo
              src={branding.logoImageUrl || "/brand-mark.svg"}
              alt=""
              width="40"
              height="40"
            />
            <span>{branding.logoText}</span>
          </Link>
          <button
            className="mobile-menu"
            aria-label={mobileOpen ? "Cerrar navegación" : "Abrir navegación"}
            aria-expanded={mobileOpen}
            aria-controls="main-nav"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <ChevronDown size={18} />
          </button>
        </div>
        <nav
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              window.matchMedia("(max-width: 540px)").matches
            ) {
              setMobileOpen(false);
              (document.querySelector(".mobile-menu") as HTMLElement)?.focus();
            }
          }}
          id="main-nav"
          className={mobileOpen ? "nav open" : "nav"}
          aria-label="Navegación principal"
        >
          <Link
            href="/"
            onClick={(e) => nav(e, "/")}
            aria-current={page === "dashboard" ? "page" : undefined}
          >
            <LayoutDashboard size={18} />
            Dashboard
          </Link>
          <Link
            href="/productos"
            onClick={(e) => nav(e, "/productos")}
            onNavigate={() => {
              if (page === "products") {
                setSearch("");
                setParams("");
              }
            }}
            aria-current={page === "products" ? "page" : undefined}
          >
            <Package size={18} />
            Productos
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <span className="workshop-dot" /> Inventario interno
        </div>
      </aside>
      <main id="main-content" className="workspace">
        <div className="notebook">
        <header className="page-heading">
          <div>
            <h1>
              {page === "dashboard" ? "Inventario del taller" : "Productos"}
              {page === "products" && total !== undefined && (
                <span className="heading-count" aria-label={`${number(total)} productos en el inventario`}>{number(total)}</span>
              )}
            </h1>
            <p>Taller ficticio · Datos de ejemplo</p>
          </div>
          {page === "dashboard" ? (
            <Link
              className="primary button"
              data-new-product
              href="/productos?crear=1"
            >
              <Plus size={18} />
              Crear producto
            </Link>
          ) : (
            <Button
              className="primary"
              data-new-product
              onClick={() => {
                updateURL({ crear: "1" });
                open("crear");
              }}
            >
              <Plus size={18} />
              Crear producto
            </Button>
          )}
        </header>
        {error && page === "dashboard" && (
          <div className="notice warning" role="alert">
            <AlertTriangle size={20} />
            <div>
              <strong>
                {invalidCategory
                  ? "Categoría no válida"
                  : "No se pudo actualizar el inventario"}
              </strong>
              <p>{error}</p>
              {metrics && <p>Valores de la última consulta confirmada. La actualización sigue sin confirmar.</p>}
              {!invalidCategory && (
                <button
                  className="text-button"
                  onClick={() => setRefresh((v) => v + 1)}
                >
                  Reintentar
                </button>
              )}
              {!ready && (
                <a
                  className="text-button"
                  href={page === "dashboard" ? "/" : "/productos"}
                  target="_blank"
                  rel="noopener"
                >
                  Abrir la aplicación directamente
                </a>
              )}
            </div>
          </div>
        )}
        {page === "dashboard" ? (
          <>
            <section
              className="metric-band"
              aria-label="Resumen de existencias"
              aria-busy={loading}
              data-unconfirmed={!!error || undefined}
            >
              {[
                "Productos",
                "Unidades",
                "Sin existencias",
                "Valor del stock",
              ].map((label, i) => {
                const content = <>
                  <span className="metric-label">
                    {label}
                    {i === 2 && <ArrowRight size={16} aria-hidden="true" />}
                  </span>
                  {metrics ? (
                    <strong data-metric={i}>
                      {i === 3
                        ? euro(metrics.valor_centimos)
                        : number(
                            [
                              metrics.productos,
                              metrics.unidades,
                              metrics.sin_existencias,
                            ][i],
                          )}
                    </strong>
                  ) : (
                    <div className="skeleton metric-skeleton" />
                  )}
                  {i >= 2 && (
                    <small>{i === 2 ? "Con stock igual a cero" : "Stock × precio"}</small>
                  )}
                </>;
                return i === 2 ? (
                  <Link
                    className="metric"
                    href="/productos?sin_existencias=1"
                    aria-label="Sin existencias: ver productos con stock cero"
                    key={label}
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="metric" key={label}>{content}</div>
                );
              })}
            </section>
            {loading && (
              <p className="load-caption" role="status">
                {metrics
                  ? "Actualizando valores confirmados…"
                  : "Cargando existencias…"}
              </p>
            )}
            <section className="category-section">
              <div className="section-heading">
                <div>
                  <h2>Inventario por categoría</h2>
                </div>
                <Link href="/productos" className="text-link" aria-label="Ver todos los productos">
                  <span>Ver todos<span className="category-link-detail"> los productos</span></span> <ArrowRight size={16} />
                </Link>
              </div>
              <div className="category-register">
                <div className="category-table-head">
                  <span>Categoría</span>
                  <span>Productos</span>
                  <span>Unidades</span>
                  <span>Valor</span>
                  <span />
                </div>
                {metrics
                  ? metrics.categorias.map((c) => (
                      <Link
                        key={c.id}
                        href={"/productos?categoria=" + encodeURIComponent(c.id)}
                        className="category-row"
                      >
                        <span className="category-name">
                          <strong>{c.nombre}</strong>
                        </span>
                        <span>
                          {number(c.productos)}
                          <small> productos</small>
                        </span>
                        <span>
                          {number(c.unidades)}
                          <small> unidades</small>
                        </span>
                        <span className="category-value"><small>Valor </small>{euro(c.valor_centimos)}</span>
                        <ArrowRight size={18} />
                      </Link>
                    ))
                  : [0, 1, 2].map((i) => (
                      <div className="skeleton category-skeleton" key={i} />
                    ))}
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="filters" aria-label="Filtrar productos">
              <div className="filter-field">
                <label htmlFor="product-search">Buscar<span className="search-label-detail"> por nombre</span></label>
                <div className="search-field">
                  <Search size={18} aria-hidden="true" />
                  <input
                    id="product-search"
                    aria-label="Buscar por nombre"
                    placeholder="Buscar por nombre…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      aria-label="Limpiar búsqueda"
                      onClick={() => setSearch("")}
                    >
                      <X size={17} />
                    </button>
                  )}
                </div>
              </div>
              <label className="category-filter filter-field">
                <span>Categoría</span>
                <select
                  aria-label="Filtrar por categoría"
                  aria-invalid={invalidCategory}
                  aria-describedby={invalidCategory ? "category-recovery" : undefined}
                  value={category}
                  onChange={(e) =>
                    updateURL({ categoria: e.target.value || null })
                  }
                >
                  <option value="">Todas las categorías</option>
                  {category && !cats.some((c) => c.id === category) && (
                    <option value={category}>Categoría no válida</option>
                  )}
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </label>
              {invalidCategory && (
                <div className="notice warning category-recovery" id="category-recovery" role="alert">
                  <AlertTriangle size={20} aria-hidden="true" />
                  <div>
                    <strong>Categoría no válida</strong>
                    <p>Elige otra categoría o muestra todas.</p>
                    <button className="text-button" onClick={() => updateURL({ categoria: null })}>
                      Mostrar todas
                    </button>
                  </div>
                </div>
              )}
            </section>
            <div className="register-status">
              <label className="zero-filter">
                <input
                  type="checkbox"
                  checked={zero}
                  onChange={(e) =>
                    updateURL({
                      sin_existencias: e.target.checked ? "1" : null,
                    })
                  }
                />
                Solo sin existencias
              </label>
            <div className="register-caption">
              <span role="status" aria-live="polite">
                {loading
                  ? "Cargando productos…"
                  : error
                    ? invalidCategory
                      ? "Filtro no válido"
                      : products.length ? "Últimos resultados confirmados" : "Listado no disponible"
                    : resultCount}
              </span>
            </div>
              {!invalidCategory && (search || category || zero) && (loading || error || products.length > 0 || total === 0) ? (
                <button
                  className="text-button clear-filters"
                  onClick={() => {
                    setSearch("");
                    updateURL({
                      q: null,
                      categoria: null,
                      sin_existencias: null,
                    });
                  }}
                >
                  Limpiar filtros <X size={14} />
                </button>
              ) : null}
            </div>
            {unresolved.length > 0 && !editor && (
              <div className="notice warning">
                <Clock3 size={20} />
                <div>
                  <strong>Envíos por confirmar</strong>
                  {unresolved.map((op) => (
                    <div key={String(op.payload.clave)}>
                      <span>{op.name}</span>
                      <button
                        className="text-button"
                        onClick={() => recover(op)}
                      >
                        Recuperar resultado
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="confirmation-strip" role="status" aria-live="polite" aria-atomic="true">
              {confirmation && (
                <div className="confirmation-notice">
                  <Check size={16} aria-hidden="true" />
                  <div className="confirmation-copy">
                    <strong><span>{confirmation.title}</span>:</strong>{" "}
                    <span className="confirmation-product">{confirmation.name}.</span>
                    {!confirmation.visible && confirmation.title !== "Producto eliminado" && (
                      <span className="confirmation-filter-note">{" "}Fuera de los filtros actuales.</span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="register" aria-busy={loading}>
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Categoría</th>
                    <th className="numeric"><span className="stock-heading">Stock</span></th>
                    <th className="numeric">Precio unitario</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {error && !invalidCategory && (
                    <tr className="register-error">
                      <td colSpan={5}>
                        <div className="notice warning" role="alert">
                          <AlertTriangle size={20} />
                          <div>
                            <strong>{confirmation ? "No se pudo actualizar el listado" : "No se pudo cargar el listado"}</strong>
                            <p>{error}</p>
                            {confirmation && <p>El cambio está guardado. Reintentar solo actualiza el listado.</p>}
                            {!invalidCategory && products.length > 0 && <p>Se conservan los últimos valores confirmados.</p>}
                            {!invalidCategory && (
                              <button className="button secondary" onClick={() => setRefresh((v) => v + 1)}>
                                Reintentar
                              </button>
                            )}
                            {!ready && (
                              <a className="text-button" href="/productos" target="_blank" rel="noopener">
                                Abrir la aplicación directamente
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {loading && !products.length
                    ? [0, 1, 2, 3, 4, 5].map((i) => (
                        <tr key={i}>
                          <td colSpan={5}>
                            <div className="skeleton row-skeleton" />
                          </td>
                        </tr>
                      ))
                    : !invalidCategory &&
                      products.map((p) => (
                        <tr
                          key={p.id}
                          data-product-id={p.id}
                          data-confirmed={confirmation?.id === p.id || undefined}
                          className={confirmation?.id === p.id ? "confirmed-row" : undefined}
                          data-selected={
                            editor?.product?.id === p.id || undefined
                          }
                        >
                          <td data-label="Nombre" className="product-name">
                            <span className="product-name-value">{p.nombre}</span>
                          </td>
                          <td data-label="Categoría">
                            <span className="category-tag">
                              {catName(p.categoria_id)}
                            </span>
                          </td>
                          <td data-label="Stock" className="numeric">
                            <span className="compact-label" aria-hidden="true">Stock</span>
                            <span
                              className={
                                p.stock === 0 ? "stock-zero" : "stock-value"
                              }
                            >
                              <span className="stock-number">{number(p.stock)}</span>
                              {p.stock === 0 && <span className="sr-only"> sin existencias</span>}
                            </span>
                            <span className="mobile-unit"> unidades</span>
                          </td>
                          <td data-label="Precio unitario" className="numeric">
                            <span className="compact-label" aria-hidden="true">Precio unitario</span>
                            <span className="price-value">{euro(p.precio_centimos)}</span>
                          </td>
                          <td className="row-actions">
                            <div className="row-action-group">
                            <button
                              aria-label={"Editar " + p.nombre}
                              onClick={(e) =>
                                open("editar", p, e.currentTarget)
                              }
                            >
                              Editar
                            </button>
                            <button
                              aria-label={"Eliminar " + p.nombre}
                              onClick={(e) =>
                                open("eliminar", p, e.currentTarget)
                              }
                            >
                              Eliminar
                            </button>
                            </div>
                            {confirmation?.id === p.id && (
                              <span className="row-confirmation" aria-hidden="true">
                                <Check size={14} />
                                {confirmation.title === "Producto creado" ? "Creado" : "Actualizado"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
              {!loading && !error && !products.length && (
                <div className="empty-state">
                  <h2>
                    {total
                      ? "No hay coincidencias"
                      : "Tu inventario está vacío"}
                  </h2>
                  <p>
                    {total
                      ? "Prueba otro nombre o cambia los filtros."
                      : "Añade el primer producto para empezar el registro."}
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      if (total) {
                        setSearch("");
                        updateURL({
                          q: null,
                          categoria: null,
                          sin_existencias: null,
                        });
                      } else {
                        updateURL({ crear: "1" });
                        open("crear");
                      }
                    }}
                  >
                    {total ? "Limpiar filtros" : "Crear producto"}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        </div>
      </main>
      <Dialog.Root
        open={!!editor}
        onOpenChange={(v) => {
          if (!v) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            role={editor?.kind === "eliminar" ? "alertdialog" : "dialog"}
            aria-modal="true"
            ref={setPanelNode}
            className="editor-panel"
            data-state-view={state}
            data-compact={state === "success" || editor?.kind === "eliminar"}
            aria-describedby="editor-description"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              setTimeout(() => {
                const field =
                  document.querySelector("#field-nombre:not(:disabled)") ||
                  document.querySelector("[data-cancel]:not(:disabled)") ||
                  document.querySelector(".editor-panel");
                if (field instanceof HTMLElement) field.focus();
              }, 0);
            }}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              if (discard) {
                setDiscard(false);
              } else close();
            }}
            onPointerDownOutside={(e) => {
              e.preventDefault();
              close();
            }}
          >
            <form onSubmit={submit} noValidate>
              <div className="editor-heading" tabIndex={-1}>
                <Dialog.Title>{name}</Dialog.Title>
                <button
                  type="button"
                  className="editor-close"
                  aria-label="Cerrar formulario"
                  disabled={state === "pending"}
                  onClick={close}
                >
                  <X size={20} />
                </button>
                <p className="scroll-cue" hidden={!editorOverflow}>
                  Más contenido abajo. Desplázate para verlo.
                </p>
              </div>
              <Dialog.Description
                id="editor-description"
                className={state !== "success" ? "sr-only" : undefined}
              >
                {state === "pending"
                  ? "Envío en curso. Espera la respuesta para conocer el resultado."
                  : state === "uncertain" || state === "new-choice"
                    ? "Los campos muestran el envío original. Recupera su resultado o inicia otro envío."
                  : state === "conflict"
                    ? editor?.kind === "eliminar"
                      ? "Compara el registro seleccionado con los datos actuales. Revisa la versión guardada antes de confirmar la eliminación de nuevo."
                      : "Compara tu borrador con los datos guardados antes de continuar."
                  : editor?.kind === "eliminar"
                    ? "La eliminación requiere tu confirmación."
                  : state === "success"
                    ? "Estos son los datos confirmados en tu inventario."
                    : "Edita los campos y guarda los cambios en tu inventario."}
              </Dialog.Description>
              {!ready && error && (
                <div className="notice warning" role="alert">
                  <AlertTriangle size={20} />
                  <div>
                    <p>{error}</p>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setRefresh((v) => v + 1)}
                    >
                      Reintentar sesión
                    </button>
                    <a
                      className="text-button"
                      href="/productos"
                      target="_blank"
                      rel="noopener"
                    >
                      Abrir la aplicación directamente
                    </a>
                  </div>
                </div>
              )}
              {discard ? (
                <div className="discard-box" role="alert">
                  <h3>{state === "uncertain" || state === "new-choice" ? "¿Cerrar y conservar el envío pendiente?" : "¿Descartar los cambios?"}</h3>
                  <p>
                    {state === "uncertain" || state === "new-choice"
                      ? "El envío anterior podría haberse aplicado. Podrás recuperarlo desde el listado."
                      : "Los cambios del borrador se perderán."}
                  </p>
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => setDiscard(false)}
                  >
                    {state === "uncertain" || state === "new-choice" ? "Volver al envío" : "Seguir editando"}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      const dest = destination;
                      finishClose();
                      if (dest) router.push(dest);
                    }}
                  >
                    {state === "uncertain" || state === "new-choice" ? "Cerrar y conservar envío pendiente" : "Descartar cambios"}
                  </button>
                </div>
              ) : (
                <>
                  {message && state !== "success" && state !== "pending" && state !== "new-choice" && state !== "conflict" && (
                    <div
                      className="notice warning"
                      role="alert"
                    >
                      <span>
                        <AlertTriangle size={20} />
                      </span>
                      <div>
                        {state === "uncertain" && <strong>Resultado sin confirmar</strong>}
                        <p>{message}</p>
                        {Object.entries(errors).length > 0 && (
                          <ul className="validation-links">
                            {Object.entries(errors).map(([k, v]) => (
                              <li key={k}>
                                <a
                                  href={"#field-" + k}
                                  aria-label={k === "precio" ? fieldInstructions[k] : undefined}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    document
                                      .getElementById("field-" + k)
                                      ?.focus();
                                  }}
                                >
                                  {k === "precio" ? "Precio" : fieldInstructions[k] || v}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                        {state === "uncertain" && operation && (
                          <div className="notice-actions">
                            <button
                              data-recover-result
                              type="button"
                              className="button primary"
                              onClick={() => send(operation)}
                            >
                              Recuperar resultado
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => {
                                setState("new-choice");
                              }}
                            >
                              Editar borrador
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {state === "new-choice" && (
                    <div className="notice warning" role="alert">
                      <div>
                        <strong>Resultado sin confirmar</strong>
                        <p>
                          El envío anterior podría haberse aplicado.
                        </p>
                        <p>
                          Recupera primero su resultado o inicia un envío
                          distinto. El anterior seguirá disponible en el
                          listado.
                        </p>
                        <div className="notice-actions">
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => operation && send(operation)}
                        >
                          Recuperar resultado
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setOperation(undefined);
                            setState("draft");
                            setMessage(
                              "Nuevo borrador. El envío anterior sigue disponible para recuperar.",
                            );
                          }}
                        >
                          Iniciar otro envío
                        </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {state === "conflict" && (
                    <div className="conflict-box">
                      <div className="conflict-heading" tabIndex={-1}>
                        <h3><AlertTriangle size={20} aria-hidden="true" /> Conflicto de cambios</h3>
                        <p role="alert">{message}</p>
                      </div>
                      <ConflictComparison draft={draft} previous={editor?.product} current={conflict} catName={catName} deletion={editor?.kind === "eliminar"} renderField={editor?.kind === "editar" ? renderField : undefined}>
                      {conflict && (
                        <>
                          <p className="reconciliation-copy">
                            {editor?.kind === "eliminar"
                              ? <span id="use-current-help">Revisa los datos actuales y confirma de nuevo la eliminación.</span>
                              : <>
                                  <span id="reconcile-help"><strong>Reconciliar</strong> conserva tu borrador sin guardar. Al guardarlo, reemplazarás los datos actuales.</span>{" "}
                                  <span id="use-current-help"><strong>Usar datos actuales</strong> sustituye el borrador.</span>
                                </>}
                          </p>
                          <div className="conflict-actions">
                          {editor?.kind !== "eliminar" && <div className="conflict-choice"><button
                            type="button"
                            className="button primary"
                            aria-describedby="reconcile-help"
                            onClick={() => {
                              setEditor({ ...editor!, product: conflict });
                              setState("draft");
                              setMessage(
                                "Borrador reconciliado, todavía sin guardar. Revisa los campos y pulsa Guardar cambios: tu borrador reemplazará los datos actuales.",
                              );
                              setOperation(undefined);
                            }}
                          >
                            Reconciliar cambios
                          </button>
                          </div>}
                          <div className="conflict-choice">
                          <button
                            type="button"
                            className={editor?.kind === "eliminar" ? "button primary" : "text-button"}
                            aria-describedby="use-current-help"
                            onClick={() => {
                              setDraft(draftOf(conflict));
                              setInitial(draftOf(conflict));
                              setEditor({ ...editor!, product: conflict });
                              setState("draft");
                              setMessage(editor?.kind === "eliminar"
                                ? "Has revisado los datos actuales. Confirma de nuevo si quieres eliminar este producto."
                                : "Se han cargado los datos actuales.");
                            }}
                          >
                            Usar datos actuales
                          </button>
                          </div>
                          <button data-cancel type="button" className="button secondary" onClick={close}>
                            Cancelar
                          </button>
                          </div>
                        </>
                      )}
                      {!conflict && (
                        <button data-cancel type="button" className="button secondary" onClick={close}>
                          Cancelar
                        </button>
                      )}
                      </ConflictComparison>
                    </div>
                  )}
                  {state === "success" && confirmed ? (
                    <dl className="confirmed-fields">
                      <div>
                        <dt>Nombre</dt>
                        <dd>{confirmed.nombre}</dd>
                      </div>
                      <div>
                        <dt>Categoría</dt>
                        <dd>{catName(confirmed.categoria_id)}</dd>
                      </div>
                      <div>
                        <dt>Stock</dt>
                        <dd>{number(confirmed.stock)} unidades</dd>
                      </div>
                      <div>
                        <dt>Precio unitario</dt>
                        <dd>{euro(confirmed.precio_centimos)}</dd>
                      </div>
                    </dl>
                  ) : state === "conflict" ? null : editor?.kind === "eliminar" ? (
                    <div className="delete-copy">
                      <h3>¿Eliminar este producto?</h3>
                      <p>
                        Se eliminará del registro y dejará de contar en las
                        existencias. Esta acción no se puede deshacer.
                      </p>
                    </div>
                  ) : (
                    <fieldset
                      disabled={
                        state === "pending" ||
                        state === "uncertain" ||
                        state === "new-choice"
                      }
                      className="fields"
                    >
                      {renderField("nombre")}
                      {renderField("categoria_id")}
                      <div className="field-pair">
                        {renderField("stock")}
                        {renderField("precio", false)}
                        {priceGuidanceVisible && <p id="hint-precio" className="field-hint">Precio: usa coma o punto decimal.</p>}
                      </div>
                    </fieldset>
                  )}
                  {state !== "conflict" && <div className="editor-footer">
                    {state !== "uncertain" && state !== "new-choice" && <div
                      className="editor-status"
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                      tabIndex={-1}
                    >
                      {state === "pending" ? <Clock3 size={16} /> : <span className="draft-dot" />}
                      <span>
                        {state === "pending" ? editor?.kind === "crear" ? "Creando producto…" : editor?.kind === "eliminar" ? "Eliminando producto…" : "Guardando cambios…"
                          : editor?.kind === "eliminar" ? "Pendiente de confirmación"
                          : dirty || editor?.kind === "crear" ? "Borrador sin guardar" : "Sin cambios"}
                      </span>
                    </div>}
                    {state === "success" ? (
                      <button
                        type="button"
                        className="button primary"
                        onClick={finishClose}
                      >
                        Cerrar
                      </button>
                    ) : (
                      <>
                        <button
                          data-cancel
                          type="button"
                          className="button secondary"
                          onClick={close}
                          disabled={state === "pending"}
                        >
                          {state === "uncertain" || state === "new-choice"
                            ? "Cerrar por ahora"
                            : "Cancelar"}
                        </button>
                        {editor?.kind !== "eliminar" && state !== "uncertain" && state !== "new-choice" && (
                          <Button
                            className="primary save-button"
                            type="submit"
                            disabled={!ready || state === "pending"}
                            aria-busy={state === "pending"}
                          >
                            {editor?.kind === "crear" ? "Guardar producto" : "Guardar cambios"}
                          </Button>
                        )}
                        {editor?.kind === "eliminar" && (
                          <button
                            type="submit"
                            className="button destructive"
                            aria-busy={state === "pending"}
                            disabled={
                              state === "pending" ||
                              state === "uncertain" ||
                              state === "new-choice"
                            }
                          >
                            Eliminar producto
                          </button>
                        )}
                      </>
                    )}
                  </div>}
                </>
              )}
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
