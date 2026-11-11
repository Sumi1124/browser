// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
#ifndef ASTER_CORE_SEARCH_H_
#define ASTER_CORE_SEARCH_H_
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace aster {
struct SearchProvider {
  std::string id;
  std::string name;
  std::string url_template;
  bool operator==(const SearchProvider&) const = default;
};
const std::vector<SearchProvider>& BuiltinProviders();
bool IsValidUtf8(std::string_view text);
// A deliberately narrow policy for search templates; GURL is the final parser
// at the Chromium boundary. No credentials, executable schemes or fragments.
bool IsValidSearchTemplate(std::string_view url);
bool IsRestorableUrl(std::string_view url);
std::optional<std::string> SearchUrl(const SearchProvider& provider,
                                     std::string_view query);

enum class SplitLayout { kColumns, kRows, kThreeColumns, kGrid };
struct Pane {
  std::size_t id;
  SearchProvider provider;
  std::string url;
};
struct Navigation {
  std::size_t pane_id;
  std::string url;
};
struct PaneRect {
  int x;
  int y;
  int width;
  int height;
  bool operator==(const PaneRect&) const = default;
};

// Pure state/policy. The native adapter owns WebContents and performs
// navigation. Calls never issue network requests or touch another profile's
// state.
class SplitSession {
 public:
  SplitSession();
  const std::vector<Pane>& panes() const { return panes_; }
  SplitLayout layout() const { return layout_; }
  double ratio() const { return ratio_; }
  bool synchronized() const { return synchronized_; }
  void SetSynchronized(bool enabled) { synchronized_ = enabled; }
  bool SetProvider(std::size_t index, const SearchProvider& provider);
  bool SetLayout(SplitLayout layout);
  bool Resize(double ratio);
  bool Swap(std::size_t first, std::size_t second);
  bool Close(std::size_t index);
  bool AdoptTab(std::size_t index, std::string_view url);
  std::optional<std::vector<Navigation>> Search(std::string_view query,
                                                std::size_t source_index);
  std::vector<PaneRect> Bounds(int width, int height, int divider = 6) const;

 private:
  std::vector<Pane> panes_;
  SplitLayout layout_ = SplitLayout::kColumns;
  double ratio_ = 0.5;
  bool synchronized_ = true;
  std::size_t next_id_ = 3;
};
}  // namespace aster
#endif  // ASTER_CORE_SEARCH_H_
