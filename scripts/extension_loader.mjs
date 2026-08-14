function isExtensionlessRelativeImport(specifier) {
  return (specifier.startsWith('./') || specifier.startsWith('../'))
    && !/\.[a-z\d]+(?:[?#].*)?$/i.test(specifier);
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (originalError) {
    if (!isExtensionlessRelativeImport(specifier)) throw originalError;
    for (const candidate of [`${specifier}.js`, `${specifier}/index.js`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // Try the next Node-compatible form.
      }
    }
    throw originalError;
  }
}
