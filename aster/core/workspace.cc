// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
#include "aster/core/workspace.h"
#include <algorithm>
#include <cstdint>
#include <set>
#include <utility>
#include "aster/core/search.h"
namespace aster {
namespace {
constexpr std::size_t kMaxBytes = 4 * 1024 * 1024;
constexpr std::size_t kMaxItems = 4096;
constexpr std::string_view kMagic = "ASTERWS1";
bool Text(std::string_view value,
          std::size_t max = 512,
          bool allow_empty = true) {
  return (allow_empty || !value.empty()) && value.size() <= max &&
         IsValidUtf8(value) &&
         std::none_of(value.begin(), value.end(),
                      [](unsigned char c) { return c < 0x20 || c == 0x7f; });
}
bool Identifier(std::string_view id) {
  return !id.empty() && id.size() <= 64 &&
         std::all_of(id.begin(), id.end(), [](char c) {
           return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
         });
}
bool SessionValid(const SavedSession& session) {
  if (!Text(session.name, 128, false) || session.tabs.size() > 256 ||
      (session.tabs.empty() ? session.active_tab != 0
                            : session.active_tab >= session.tabs.size()))
    return false;
  return std::all_of(session.tabs.begin(), session.tabs.end(),
                     [](const SavedTab& tab) {
                       return IsRestorableUrl(tab.url) && Text(tab.title) &&
                              Text(tab.group, 128);
                     });
}
bool BookmarkValid(const Bookmark& bookmark) {
  return IsRestorableUrl(bookmark.url) && Text(bookmark.title) &&
         Text(bookmark.folder, 128);
}
void Number(std::string& bytes, std::uint32_t value) {
  for (unsigned i = 0; i < 4; ++i)
    bytes.push_back(static_cast<char>((value >> (i * 8)) & 255));
}
void String(std::string& bytes, std::string_view value) {
  Number(bytes, static_cast<std::uint32_t>(value.size()));
  bytes.append(value);
}
class Reader {
 public:
  explicit Reader(std::string_view bytes) : bytes_(bytes) {}
  std::uint32_t Number(std::uint32_t maximum) {
    if (bytes_.size() - position_ < 4) {
      valid_ = false;
      return 0;
    }
    std::uint32_t result = 0;
    for (unsigned i = 0; i < 4; ++i)
      result |= static_cast<std::uint32_t>(
                    static_cast<unsigned char>(bytes_[position_++]))
                << (8 * i);
    if (result > maximum) {
      valid_ = false;
      return 0;
    }
    return result;
  }
  std::string String() {
    auto length = Number(32768);
    if (!valid_ || length > bytes_.size() - position_) {
      valid_ = false;
      return {};
    }
    auto result = std::string(bytes_.substr(position_, length));
    position_ += length;
    return result;
  }
  bool valid() const { return valid_; }
  bool done() const { return valid_ && position_ == bytes_.size(); }

 private:
  std::string_view bytes_;
  std::size_t position_ = 0;
  bool valid_ = true;
};
}  // namespace
WorkspaceCatalog DefaultWorkspaces() {
  return {{{"personal", "Personal", {}, {}},
           {"business", "Business", {}, {}},
           {"ib-myp", "IB MYP", {}, {}},
           {"ib-dp", "IB Diploma Programme", {}, {}},
           {"research", "Research and Data Analysis", {}, {}}},
          "personal"};
}
bool ValidateCatalog(const WorkspaceCatalog& catalog) {
  if (catalog.workspaces.empty() || catalog.workspaces.size() > 64)
    return false;
  std::set<std::string> ids;
  std::size_t total = 0;
  for (const auto& workspace : catalog.workspaces) {
    if (!Identifier(workspace.id) || !ids.insert(workspace.id).second ||
        !Text(workspace.name, 128, false) || workspace.sessions.size() > 16 ||
        workspace.bookmarks.size() > 512)
      return false;
    total += workspace.bookmarks.size();
    std::set<std::string> names;
    for (const auto& session : workspace.sessions) {
      if (!SessionValid(session) || !names.insert(session.name).second)
        return false;
      total += session.tabs.size();
    }
    if (total > kMaxItems ||
        !std::all_of(workspace.bookmarks.begin(), workspace.bookmarks.end(),
                     BookmarkValid))
      return false;
  }
  return ids.contains(catalog.active_id);
}
bool AddWorkspace(WorkspaceCatalog& catalog, std::string id, std::string name) {
  auto next = catalog;
  next.workspaces.push_back({std::move(id), std::move(name), {}, {}});
  if (!ValidateCatalog(next))
    return false;
  catalog = std::move(next);
  return true;
}
bool SaveSession(WorkspaceCatalog& catalog,
                 std::string_view workspace_id,
                 const SavedSession& session) {
  auto next = catalog;
  for (auto& workspace : next.workspaces) {
    if (workspace.id != workspace_id)
      continue;
    auto it = std::find_if(
        workspace.sessions.begin(), workspace.sessions.end(),
        [&](const auto& saved) { return saved.name == session.name; });
    if (it == workspace.sessions.end())
      workspace.sessions.push_back(session);
    else
      *it = session;
    if (!ValidateCatalog(next))
      return false;
    catalog = std::move(next);
    return true;
  }
  return false;
}
bool AddBookmark(WorkspaceCatalog& catalog,
                 std::string_view workspace_id,
                 const Bookmark& bookmark) {
  auto next = catalog;
  for (auto& workspace : next.workspaces) {
    if (workspace.id != workspace_id)
      continue;
    auto it = std::find_if(workspace.bookmarks.begin(),
                           workspace.bookmarks.end(), [&](const auto& saved) {
                             return saved.url == bookmark.url &&
                                    saved.folder == bookmark.folder;
                           });
    if (it == workspace.bookmarks.end())
      workspace.bookmarks.push_back(bookmark);
    else
      *it = bookmark;
    if (!ValidateCatalog(next))
      return false;
    catalog = std::move(next);
    return true;
  }
  return false;
}
std::optional<std::string> EncodeCatalog(const WorkspaceCatalog& catalog,
                                         bool off_the_record) {
  if (off_the_record || !ValidateCatalog(catalog))
    return std::nullopt;
  std::string bytes(kMagic);
  String(bytes, catalog.active_id);
  Number(bytes, static_cast<std::uint32_t>(catalog.workspaces.size()));
  for (const auto& workspace : catalog.workspaces) {
    String(bytes, workspace.id);
    String(bytes, workspace.name);
    Number(bytes, static_cast<std::uint32_t>(workspace.sessions.size()));
    for (const auto& session : workspace.sessions) {
      String(bytes, session.name);
      Number(bytes, static_cast<std::uint32_t>(session.active_tab));
      Number(bytes, static_cast<std::uint32_t>(session.tabs.size()));
      for (const auto& tab : session.tabs) {
        String(bytes, tab.url);
        String(bytes, tab.title);
        String(bytes, tab.group);
        Number(bytes, tab.pinned ? 1 : 0);
        if (bytes.size() > kMaxBytes)
          return std::nullopt;
      }
    }
    Number(bytes, static_cast<std::uint32_t>(workspace.bookmarks.size()));
    for (const auto& bookmark : workspace.bookmarks) {
      String(bytes, bookmark.url);
      String(bytes, bookmark.title);
      String(bytes, bookmark.folder);
      if (bytes.size() > kMaxBytes)
        return std::nullopt;
    }
  }
  if (bytes.size() > kMaxBytes)
    return std::nullopt;
  return bytes;
}
std::optional<WorkspaceCatalog> DecodeCatalog(std::string_view bytes) {
  if (bytes.size() > kMaxBytes || !bytes.starts_with(kMagic))
    return std::nullopt;
  Reader reader(bytes.substr(kMagic.size()));
  WorkspaceCatalog catalog;
  catalog.active_id = reader.String();
  const auto count = reader.Number(64);
  std::size_t total = 0;
  for (std::uint32_t i = 0; i < count && reader.valid(); ++i) {
    Workspace workspace;
    workspace.id = reader.String();
    workspace.name = reader.String();
    auto sessions = reader.Number(16);
    for (std::uint32_t j = 0; j < sessions && reader.valid(); ++j) {
      SavedSession session;
      session.name = reader.String();
      session.active_tab = reader.Number(255);
      auto tabs = reader.Number(256);
      total += tabs;
      if (total > kMaxItems)
        return std::nullopt;
      for (std::uint32_t k = 0; k < tabs && reader.valid(); ++k) {
        SavedTab tab;
        tab.url = reader.String();
        tab.title = reader.String();
        tab.group = reader.String();
        tab.pinned = reader.Number(1) == 1;
        session.tabs.push_back(std::move(tab));
      }
      workspace.sessions.push_back(std::move(session));
    }
    auto bookmarks = reader.Number(512);
    total += bookmarks;
    if (total > kMaxItems)
      return std::nullopt;
    for (std::uint32_t j = 0; j < bookmarks && reader.valid(); ++j) {
      Bookmark bookmark;
      bookmark.url = reader.String();
      bookmark.title = reader.String();
      bookmark.folder = reader.String();
      workspace.bookmarks.push_back(std::move(bookmark));
    }
    catalog.workspaces.push_back(std::move(workspace));
  }
  if (!reader.done() || !ValidateCatalog(catalog))
    return std::nullopt;
  return catalog;
}
}  // namespace aster
