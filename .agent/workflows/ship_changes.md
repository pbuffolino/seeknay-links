---
description: Deploy changes: validate locally, confirm, update docs, and push.
---

1.  **Validate Locally**

    - Start the local server if needed:
      ```bash
      python3 -m http.server 8080
      ```
    - Use the `browser_subagent` to visually verify the changes.
    - Capture screenshots of significant changes.

2.  **User Confirmation**

    - Notify the user with the validation results and screenshots.
    - **STOP** and wait for explicit approval to continue.

3.  **Update Documentation**

    - Read `README.md` to check if updates are needed.
    - Update `README.md` with new features or instructions.
    - Ensure code files have appropriate comments (JSDoc, etc.).

4.  **Ship It**
    - Check status:
      ```bash
      git status
      ```
    - Stage changes:
      ```bash
      git add .
      ```
    - Commit (replace message with descriptive text):
      ```bash
      git commit -m "feat: <description>"
      ```
    - Push:
      ```bash
      git push
      ```
