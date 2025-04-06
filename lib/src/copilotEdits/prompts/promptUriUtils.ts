import type { EditTurnContext } from '../resources/editTurnContext.ts';

// import { URI } from 'webpack://LIB/src/utils.ts';
import { URI } from 'vscode-uri';

class CopilotEditsPromptUriUtils {
  static pathToUri(editTurnContext: EditTurnContext, path: string) {
    let workingSetUri = editTurnContext.mapToUriInWorkingSet(path);
    return workingSetUri || URI.parse(path).toString();
  }

  static uriToPath(uri: URI | string) {
    if (typeof uri == 'string') {
      uri = URI.parse(uri);
    }

    return uri.scheme === 'file' ? uri.fsPath : uri.toString();
  }

  static posixFilePathToUri(absolutePosixFilePath: string) {
    return process.platform === 'win32' ? `file:///C:${absolutePosixFilePath}` : `file://${absolutePosixFilePath}`;
  }
}

export { CopilotEditsPromptUriUtils };
