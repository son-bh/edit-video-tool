import type { Request, Response } from 'express';

import type { AppContext } from '../context';
import { SCRIPT_JSON_EXAMPLE } from '../config/media';
import { getAssetVersion } from '../http/files';

export function createPageController(context: Pick<AppContext, 'repoRoot'>) {
  return {
    renderHome(request: Request, response: Response): void {
      response.render('index', {
        title: 'Media Workflow UI',
        assetVersion: getAssetVersion(context.repoRoot),
        currentUser: request.auth?.username || ''
      });
    },
    downloadScriptJsonExample(_request: Request, response: Response): void {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Content-Disposition', 'attachment; filename="script.example.json"');
      response.send(SCRIPT_JSON_EXAMPLE + '\n');
    }
  };
}
