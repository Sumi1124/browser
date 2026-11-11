// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
#ifndef ASTER_CORE_WORKSPACE_H_
#define ASTER_CORE_WORKSPACE_H_
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>
namespace aster {
struct SavedTab {
  std::string url;
  std::string title;
  std::string group;
  bool pinned = false;
  bool operator==(const SavedTab&) const = default;
};
struct Bookmark {
  std::string url;
  std::string title;
  std::string folder;
  bool operator==(const Bookmark&) const = default;
};
struct SavedSession {
  std::string name;
  std::vector<SavedTab> tabs;
  std::size_t active_tab = 0;
  bool operator==(const SavedSession&) const = default;
};
struct Workspace {
  std::string id;
  std::string name;
  std::vector<SavedSession> sessions;
  std::vector<Bookmark> bookmarks;
  bool operator==(const Workspace&) const = default;
};
struct WorkspaceCatalog {
  std::vector<Workspace> workspaces;
  std::string active_id;
  bool operator==(const WorkspaceCatalog&) const = default;
};
WorkspaceCatalog DefaultWorkspaces();
bool ValidateCatalog(const WorkspaceCatalog& catalog);
bool AddWorkspace(WorkspaceCatalog& catalog, std::string id, std::string name);
bool SaveSession(WorkspaceCatalog& catalog,
                 std::string_view workspace_id,
                 const SavedSession& session);
bool AddBookmark(WorkspaceCatalog& catalog,
                 std::string_view workspace_id,
                 const Bookmark& bookmark);
// Bounded, versioned binary codec. The Chromium adapter stores base64 in that
// Profile's PrefService (no sync). Private profiles must never be serialized.
std::optional<std::string> EncodeCatalog(const WorkspaceCatalog& catalog,
                                         bool off_the_record);
std::optional<WorkspaceCatalog> DecodeCatalog(std::string_view bytes);
}  // namespace aster
#endif  // ASTER_CORE_WORKSPACE_H_
