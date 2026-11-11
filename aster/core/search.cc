// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
#include "aster/core/search.h"
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace aster {
namespace {
bool HasControl(std::string_view value) {
  return std::any_of(value.begin(), value.end(), [](unsigned char c) {
    return c <= 0x20 || c == 0x7f || c == '\\';
  });
}
bool IsNetworkUrl(std::string_view url, bool https_only) {
  if (url.size() > 32768 || HasControl(url) || !IsValidUtf8(url))
    return false;
  const std::size_t start =
      url.starts_with("https://")
          ? 8
          : (!https_only && url.starts_with("http://") ? 7 : 0);
  if (!start)
    return false;
  const auto end = url.find_first_of("/?#", start);
  auto host =
      url.substr(start, end == std::string_view::npos ? end : end - start);
  if (host.empty() || host.size() > 259)
    return false;
  if (auto colon = host.find(':'); colon != std::string_view::npos) {
    const auto port = host.substr(colon + 1);
    if (port.empty() || port.size() > 5)
      return false;
    unsigned value = 0;
    for (char c : port) {
      if (c < '0' || c > '9')
        return false;
      value = value * 10 + static_cast<unsigned>(c - '0');
    }
    if (value == 0 || value > 65535)
      return false;
    host = host.substr(0, colon);
  }
  if (host.empty())
    return false;
  // IDNs must be supplied as punycode; IPv6 session URLs are not yet supported.
  for (unsigned char c : host) {
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '-' || c == '.'))
      return false;
  }
  std::size_t offset = 0;
  while (offset < host.size()) {
    auto dot = host.find('.', offset);
    auto label =
        host.substr(offset, dot == std::string_view::npos ? dot : dot - offset);
    if (label.empty() || label.size() > 63 || label.front() == '-' ||
        label.back() == '-')
      return false;
    if (dot == std::string_view::npos)
      break;
    offset = dot + 1;
    if (offset == host.size())
      return false;
  }
  return true;
}
std::string Encode(std::string_view value) {
  constexpr char hex[] = "0123456789ABCDEF";
  std::string encoded;
  for (unsigned char c : value) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' ||
        c == '~') {
      encoded.push_back(static_cast<char>(c));
    } else {
      encoded += '%';
      encoded += hex[c >> 4];
      encoded += hex[c & 15];
    }
  }
  return encoded;
}
}  // namespace

const std::vector<SearchProvider>& BuiltinProviders() {
  static const std::vector<SearchProvider> providers = {
      {"google", "Google", "https://www.google.com/search?q={query}"},
      {"duckduckgo", "DuckDuckGo", "https://duckduckgo.com/?q={query}"},
      {"bing", "Bing", "https://www.bing.com/search?q={query}"},
      {"brave", "Brave Search", "https://search.brave.com/search?q={query}"},
      {"yahoo", "Yahoo", "https://search.yahoo.com/search?p={query}"},
      {"ecosia", "Ecosia", "https://www.ecosia.org/search?q={query}"}};
  return providers;
}
bool IsValidUtf8(std::string_view text) {
  for (std::size_t i = 0; i < text.size();) {
    auto c = static_cast<unsigned char>(text[i++]);
    if (c < 0x80)
      continue;
    std::uint32_t code = 0;
    unsigned count = 0;
    std::uint32_t minimum = 0;
    if (c >= 0xc2 && c <= 0xdf) {
      count = 1;
      minimum = 0x80;
      code = c & 31;
    } else if (c >= 0xe0 && c <= 0xef) {
      count = 2;
      minimum = 0x800;
      code = c & 15;
    } else if (c >= 0xf0 && c <= 0xf4) {
      count = 3;
      minimum = 0x10000;
      code = c & 7;
    } else
      return false;
    if (i + count > text.size())
      return false;
    for (unsigned j = 0; j < count; ++j) {
      auto next = static_cast<unsigned char>(text[i++]);
      if ((next & 0xc0) != 0x80)
        return false;
      code = (code << 6) | (next & 63);
    }
    if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      return false;
  }
  return true;
}
bool IsValidSearchTemplate(std::string_view url) {
  if (url.size() > 2048 || !IsNetworkUrl(url, true) ||
      url.find('#') != url.npos)
    return false;
  const auto marker = url.find("{query}");
  const auto authority_end = url.find_first_of("/?", 8);
  return marker != url.npos && authority_end != url.npos &&
         marker > authority_end &&
         url.find("{query}", marker + 7) == url.npos &&
         url.find('{') == marker && url.find('}') == marker + 6 &&
         url.find_first_of("{}", marker + 7) == url.npos;
}
bool IsRestorableUrl(std::string_view url) {
  return url == "about:blank" || url == "chrome://newtab/" ||
         IsNetworkUrl(url, false);
}
std::optional<std::string> SearchUrl(const SearchProvider& provider,
                                     std::string_view query) {
  if (!IsValidSearchTemplate(provider.url_template) || query.empty() ||
      query.size() > 4096 || !IsValidUtf8(query) ||
      std::all_of(query.begin(), query.end(),
                  [](unsigned char c) { return c <= 0x20; }) ||
      std::any_of(query.begin(), query.end(),
                  [](unsigned char c) { return c < 0x20 || c == 0x7f; }))
    return std::nullopt;
  auto url = provider.url_template;
  url.replace(url.find("{query}"), 7, Encode(query));
  return url;
}
SplitSession::SplitSession()
    : panes_({{1, BuiltinProviders()[0], "about:blank"},
              {2, BuiltinProviders()[1], "about:blank"}}) {}
bool SplitSession::SetProvider(std::size_t index,
                               const SearchProvider& provider) {
  if (index >= panes_.size() || !IsValidSearchTemplate(provider.url_template))
    return false;
  panes_[index].provider = provider;
  return true;
}
bool SplitSession::SetLayout(SplitLayout layout) {
  std::size_t target;
  switch (layout) {
    case SplitLayout::kColumns:
    case SplitLayout::kRows:
      target = 2;
      break;
    case SplitLayout::kThreeColumns:
      target = 3;
      break;
    case SplitLayout::kGrid:
      target = 4;
      break;
    default:
      return false;
  }
  // Never silently discard a page when changing layouts. Close panes first.
  if (target < panes_.size())
    return false;
  while (panes_.size() < target) {
    panes_.push_back(
        {next_id_++, BuiltinProviders()[panes_.size()], "about:blank"});
  }
  layout_ = layout;
  return true;
}
bool SplitSession::Resize(double ratio) {
  if (!std::isfinite(ratio))
    return false;
  ratio_ = std::clamp(ratio, 0.15, 0.85);
  return true;
}
bool SplitSession::Swap(std::size_t first, std::size_t second) {
  if (first >= panes_.size() || second >= panes_.size())
    return false;
  std::swap(panes_[first], panes_[second]);
  return true;
}
bool SplitSession::Close(std::size_t index) {
  if (index >= panes_.size() || panes_.size() == 1)
    return false;
  panes_.erase(panes_.begin() + static_cast<std::ptrdiff_t>(index));
  if (panes_.size() == 3)
    layout_ = SplitLayout::kThreeColumns;
  if (panes_.size() == 2 && layout_ != SplitLayout::kRows)
    layout_ = SplitLayout::kColumns;
  return true;
}
bool SplitSession::AdoptTab(std::size_t index, std::string_view url) {
  if (index >= panes_.size() || !IsRestorableUrl(url))
    return false;
  panes_[index].url = url;
  return true;
}
std::optional<std::vector<Navigation>> SplitSession::Search(
    std::string_view query,
    std::size_t source) {
  if (source >= panes_.size())
    return std::nullopt;
  std::vector<Navigation> result;
  // Validate all destinations before changing any state.
  for (std::size_t i = 0; i < panes_.size(); ++i) {
    if (!synchronized_ && i != source)
      continue;
    auto url = SearchUrl(panes_[i].provider, query);
    if (!url)
      return std::nullopt;
    result.push_back({panes_[i].id, *url});
  }
  for (const auto& navigation : result) {
    for (auto& pane : panes_)
      if (pane.id == navigation.pane_id)
        pane.url = navigation.url;
  }
  return result;
}
std::vector<PaneRect> SplitSession::Bounds(int width,
                                           int height,
                                           int divider) const {
  width = std::max(0, width);
  height = std::max(0, height);
  divider = std::clamp(divider, 0, std::min(width, height));
  if (panes_.size() == 1)
    return {{0, 0, width, height}};
  if (layout_ == SplitLayout::kRows) {
    int first = static_cast<int>((height - divider) * ratio_);
    return {{0, 0, width, first},
            {0, first + divider, width, height - first - divider}};
  }
  if (panes_.size() == 4) {
    int first = static_cast<int>((width - divider) * ratio_);
    int top = (height - divider) / 2;
    return {{0, 0, first, top},
            {first + divider, 0, width - first - divider, top},
            {0, top + divider, first, height - top - divider},
            {first + divider, top + divider, width - first - divider,
             height - top - divider}};
  }
  const int gaps = static_cast<int>(panes_.size() - 1);
  divider = std::min(divider, width / gaps);
  const int available = width - divider * gaps;
  int first =
      panes_.size() == 2 ? static_cast<int>(available * ratio_) : available / 3;
  std::vector<PaneRect> result;
  int x = 0;
  for (std::size_t i = 0; i < panes_.size(); ++i) {
    int part = i + 1 == panes_.size() ? width - x : first;
    result.push_back({x, 0, part, height});
    x += part;
    if (i + 1 < panes_.size())
      x += divider;
  }
  return result;
}
}  // namespace aster
