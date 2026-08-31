import { PermanentError } from './util';

export async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 3000
): Promise<T> {

  let error: unknown;

  for (let i = 1; i <= retries; i++) {

    try {

      return await fn();

    } catch (err) {

      error = err;

      // No number of attempts turns an unknown SKU into a valid one.
      if (err instanceof PermanentError) {
        throw err;
      }

      if (i < retries) {

        console.warn(
          `[RETRY] attempt ${i}/${retries} failed, retrying in ${delay}ms`
        );

        await new Promise(resolve =>
          setTimeout(resolve, delay)
        );
      }
    }
  }

  throw error;
}
