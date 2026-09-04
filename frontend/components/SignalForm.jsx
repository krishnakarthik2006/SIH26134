import { useForm } from 'react-hook-form'
import { createSignal } from '../api.js'

export default function SignalForm({ onComplete }) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm()

  const submit = async (values) => {
    await createSignal(values)
    reset()
    onComplete?.()
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="signal-form">
      <label className="form-label">Role profile title<input {...register('title', { required: true })} placeholder="e.g. Cloud Data Analyst" />{errors.title && <small>Role title is required.</small>}</label>
      <label className="form-label">Source organization<input {...register('source', { required: true })} placeholder="e.g. Tata Digital" />{errors.source && <small>Organization is required.</small>}</label>
      <button className="primary-button full-width" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Sending...' : 'Send to AI normalization'}</button>
    </form>
  )
}
