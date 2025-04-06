import type { WorkDoneToken } from '../../../lib/src/types.ts';
import type { Context } from '../../../lib/src/context.ts';
import { EditProgressReporter } from '../../../lib/src/copilotEdits/progress/editProgressReporter.ts';
import '../types/src/index.ts';

async function streamMockedResult(
  ctx: Context,
  editConversationId: string,
  editTurnId: string,
  partialResultToken: WorkDoneToken
) {
  const javaFileUri = 'file:///path/to/HelloWorld.java';
  const reporter = ctx.get(EditProgressReporter);

  await reporter.report(partialResultToken, {
    editConversationId,
    editTurnId,
    fileGenerationStatus: 'edit-plan-generated',
    editDescription: `### [HelloWorld.java](${javaFileUri})

Complete the \`main\` method to print "Hello, World!" to the console.`,
    uri: javaFileUri,
  });

  await reporter.report(partialResultToken, {
    editConversationId,
    editTurnId,
    fileGenerationStatus: 'updated-code-generated',
    uri: javaFileUri,
    partialText: `public class HelloWorld {
  public static void main(String[] args) {
      System.out.println("Hello, World!");
  }
}`,
    languageId: 'java',
    markdownCodeFence: '```',
  });

  const pythonFileUri = 'file:///path/to/HelloWorld.py';

  await reporter.report(partialResultToken, {
    editConversationId,
    editTurnId,
    fileGenerationStatus: 'edit-plan-generated',
    editDescription: `### [HelloWorld.py](${pythonFileUri})

Complete the \`main\` method to print "Hello, World!" to the console.`,
    uri: pythonFileUri,
  });

  await reporter.report(partialResultToken, {
    editConversationId,
    editTurnId,
    fileGenerationStatus: 'updated-code-generating',
    uri: pythonFileUri,
    partialText: `def main():
`,
    languageId: 'python',
    markdownCodeFence: '```',
  });

  await reporter.report(partialResultToken, {
    editConversationId,
    editTurnId,
    fileGenerationStatus: 'updated-code-generating',
    uri: pythonFileUri,
    partialText: `    println("Hello, World!")
`,
    languageId: 'python',
    markdownCodeFence: '```',
  });

  await reporter.report(partialResultToken, {
    editConversationId,
    editTurnId,
    fileGenerationStatus: 'updated-code-generated',
    uri: pythonFileUri,
    partialText: '',
    languageId: 'python',
    markdownCodeFence: '```',
  });
}

export { streamMockedResult };
