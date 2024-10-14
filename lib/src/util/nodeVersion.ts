function errorMessageForUnsupportedNodeVersion(version = process.versions.node) {
  const [major, _minor, _] = version.split('.').map((v) => parseInt(v, 10));
  if (major < 18) return `Node.js 18.x is required to run GitHub Copilot but found ${version}`;
}
export { errorMessageForUnsupportedNodeVersion };
