/**
 * Preview deploy identity stamp — values filled at deploy from `git rev-parse HEAD`.
 * Do not hand-edit with a fake sha. Local default stays null until stamped for upload.
 */
export const KEY_DEPLOY_IDENTITY = {
  git_commit_sha: null,
  source: null,
};
