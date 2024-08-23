export const exampleMarkdown = `
    # Should render

    ## Links
    Links should render. However, if a user clicks on the link, it should open a confirmation dialog before navigating to the link.

    markdown:

    [GitHub Copilot](https://copilot.github.com)

    html:

    <a href="https://copilot.github.com">GitHub Copilot</a>

    ## Images
    The following images do come from one of these sources and should render:

    - \`raw.githubusercontent.com/\`
    - \`private-user-images.githubusercontent.com/\`
    - \`avatars.githubusercontent.com\`
    - \`gist.github.com/assets/\`


    markdown:

    ![logo](https://avatars.githubusercontent.com/u/147005046?v=4)

    html:

    <img src="https://avatars.githubusercontent.com/u/147005046?v=4" alt="logo"/>

    ## Headers

    markdown:

    # Header 1
    ## Header 2
    ### Header 3
    #### Header 4
    ##### Header 5
    ###### Header 6

    html:

    <h1>Header 1</h1>
    <h2>Header 2</h2>
    <h3>Header 3</h3>
    <h4>Header 4</h4>
    <h5>Header 5</h5>
    <h6>Header 6</h6>

    ## Paragraphs

    html:

    <p>This is a paragraph.</p>

    ## Bold

    markdown:

    **bold text**

    html:

    <strong>bold text</strong>

    ## Italic

    markdown:

    _italic text_

    html:

    <i>italic text</i>

    ## Codeblock

    markdown:

    \`\`\`javascript
    console.log('Hello, World!');
    \`\`\`

    html:

    <code>console.log('Hello, World!');</code>

    ## Unordered List

    markdown:

    - item 1
    - item 2
    - item 3

    html:

    <ul>
      <li>item 1</li>
      <li>item 2</li>
      <li>item 3</li>
    </ul>

    ## Ordered List

    markdown:

    1. item 1
    2. item 2
    3. item 3

    html:

    <ol>
      <li>item 1</li>
      <li>item 2</li>
      <li>item 3</li>
    </ol>

    ## Table

    markdown:

    | Header 1 | Header 2 | Header 3 |
    |----------|----------|----------|
    | cell 1   | cell 2   | cell 3   |
    | cell 4   | cell 5   | cell 6   |

    html:

    <table>
        <thead>
            <tr>
                <th>Header 1</th>
                <th>Header 2</th>
                <th>Header 3</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>cell 1</td>
                <td>cell 2</td>
                <td>cell 3</td>
            </tr>
            <tr>
                <td>cell 4</td>
                <td>cell 5</td>
                <td>cell 6</td>
            </tr>
        </tbody>
    </table>

    ## Blockquote

    markdown:

    > This is a blockquote.

    html:

    <blockquote>This is a blockquote.</blockquote>


    # Should not render

    ## html tags
    Unsupported tags like \`<div>\` should not render but should be escaped. This code:

    \`\`\`html
    <div><ul><li>Foo</li></ul><img src="https://github.com/images/modules/site/copilot/productivity-bg-head.png" alt="productivity" width="20"/>
    \`\`\`

    should be rendered as:

    \`\`\`html
    <div>
    * Foo
    <img src="https://github.com/images/modules/site/copilot/productivity-bg-head.png" alt="productivity" width="20"/>
    \`\`\`

    code:

    <div><ul><li>Foo</li></ul><img src="https://github.com/images/modules/site/copilot/productivity-bg-head.png" alt="productivity" width="20"/></div>

    ## images
    The following images do *not* come from one of the trusted domains and should not render.

    markdown:

    ![productivity](https://github.com/images/modules/site/copilot/productivity-bg-head.png)

    html:

    <img src="https://github.com/images/modules/site/copilot/productivity-bg-head.png" alt="productivity" width="100"/>

    ## Invisible characters

    ### Inline styles
    Styled elements should not be rendered styled. This may trick the user to think elements are actually IDE controls

    <p style="color: red;">This is an <span style="display: none;">harmfully</span> styled text!</p>

    ### html attributes
    Only img src/alt and a href attributes should make it to the dom.

    The following paragraph should not render the \`id\` attribute in the dom.

    <p id="foo">This is a paragraph with an id</p>
    `;
