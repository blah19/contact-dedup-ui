export type Problem = {
  type: string
  title: string
  status: number
  detail?: string
}

export type Customer = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
}

export type MatchItem = {
  id: string
  score: number
  status: 'pending' | 'merged' | 'ignored'
  customerAId: string
  customerBId: string
  customerA?: Customer
  customerB?: Customer
}

export type ListMatchesResponse = {
  items: MatchItem[]
}
