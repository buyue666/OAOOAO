import { redirect } from 'next/navigation'

export default function Page() {
  // The project workspace owns the persisted outline, shot and Agent flow.
  // Keep existing bookmarks useful without exposing the retired analyzer form.
  redirect('/projects')
}
