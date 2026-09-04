import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export const getOverview = () => api.get('/overview').then(({ data }) => data)
export const createSignal = (payload) => api.post('/signals', payload).then(({ data }) => data)

export default api
