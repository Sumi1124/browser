// Copyright 2026 Aster contributors. BSD-3-Clause; see //aster/LICENSE.
#ifndef CHROME_BROWSER_UI_VIEWS_TOOLBAR_ASTER_PRODUCTIVITY_H_
#define CHROME_BROWSER_UI_VIEWS_TOOLBAR_ASTER_PRODUCTIVITY_H_
#include <memory>
#include <string>
#include "aster/core/search.h"
class BrowserWindowInterface;
namespace views {
class View;
}
namespace aster {
struct SplitSearchRequest {
  std::string query;
  SearchProvider left = BuiltinProviders()[0];
  SearchProvider right = BuiltinProviders()[1];
  bool synchronize = true;
  bool reuse_current_tab = false;
  bool stacked = false;
};
// Uses normal Chromium tabs and native split collections. No embedded frames,
// privileged bindings, renderer injection, or alternate WebContents delegate.
bool RunSplitSearch(BrowserWindowInterface* browser,
                    const SplitSearchRequest& request);
std::unique_ptr<views::View> CreateSplitSearchButton(
    BrowserWindowInterface* browser);
std::unique_ptr<views::View> CreateWorkspacesButton(
    BrowserWindowInterface* browser);
}  // namespace aster
#endif
