// SPDX-License-Identifier: Apache-2.0
import { Link } from './Link.js';

export interface ErrorStateProps {
  title: string;
  message: string;
}

/** Friendly full-page error with a way back home. */
export function ErrorState({ title, message }: ErrorStateProps) {
  return (
    <main className="message-page" data-testid="error-state">
      <h1>{title}</h1>
      <p role="alert">{message}</p>
      <Link to="/" className="btn solid">
        Back to all environments
      </Link>
    </main>
  );
}
