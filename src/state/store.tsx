import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_PLAN, type DecomChoice, type Move, type NewOrder, type Plan, type ReqStatus, type Strategy } from '../lib/capacity'

interface PersistedState {
  region: string
  plan: Plan
}

const STORAGE_KEY = 'sdn-capacity-v5'
const initialState = (): PersistedState => ({ region: 'all', plan: DEFAULT_PLAN })

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      return { ...initialState(), ...s, plan: { ...DEFAULT_PLAN, ...s.plan } }
    }
  } catch {
    /* ignore corrupt state */
  }
  return initialState()
}

interface Store extends PersistedState {
  setRegion: (r: string) => void
  setStrategy: (s: Strategy) => void
  setSlip: (months: number) => void
  setDecom: (rackIds: string[], choice: DecomChoice) => void
  decide: (reqId: string, status: ReqStatus, extras?: { order?: NewOrder; nowRacks?: number }) => void
  addMove: (m: Move) => void
  removeMove: (id: string) => void
  reset: () => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadState)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const store = useMemo<Store>(() => {
    const patch = (f: (p: Plan) => Partial<Plan>) => setState((s) => ({ ...s, plan: { ...s.plan, ...f(s.plan) } }))
    return {
      ...state,
      setRegion: (region) => setState((s) => ({ ...s, region })),
      setStrategy: (strategy) => patch(() => ({ strategy })),
      setSlip: (gen11Slip) => patch(() => ({ gen11Slip })),
      setDecom: (ids, choice) =>
        patch((p) => {
          const decom = { ...p.decom }
          for (const id of ids) {
            if (choice === 'plan') delete decom[id]
            else decom[id] = choice
          }
          return { decom }
        }),
      decide: (reqId, status, extras = {}) =>
        patch((p) => {
          // Orders tied to a request only exist while the request is committed.
          const committed = status === 'Approved' || status === 'Phased'
          const orders = p.orders.filter((o) => o.reqId !== reqId)
          if (committed && extras.order) orders.push({ ...extras.order, reqId })
          const phasedRacks = { ...p.phasedRacks }
          delete phasedRacks[reqId]
          if (status === 'Phased' && extras.nowRacks !== undefined) phasedRacks[reqId] = extras.nowRacks
          return { orders, phasedRacks, requests: { ...p.requests, [reqId]: status } }
        }),
      addMove: (m) => patch((p) => ({ moves: [...p.moves.filter((x) => x.id !== m.id), m] })),
      removeMove: (id) => patch((p) => ({ moves: p.moves.filter((x) => x.id !== id) })),
      reset: () => {
        localStorage.removeItem(STORAGE_KEY)
        setState(initialState())
      },
    }
  }, [state])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}
