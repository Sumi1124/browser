// Copyright 2026 Aster contributors. BSD-3-Clause; see //aster/LICENSE.
#include "chrome/browser/ui/views/toolbar/aster_productivity.h"
#include <algorithm>
#include <map>
#include <optional>
#include <utility>
#include <vector>
#include "aster/core/workspace.h"
#include "base/base64.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "base/uuid.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/split_tab_metrics.h"
#include "chrome/browser/ui/tabs/tab_group_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/prefs/pref_service.h"
#include "components/split_tabs/split_tab_visual_data.h"
#include "components/tab_groups/tab_group_visual_data.h"
#include "components/tabs/public/tab_group.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/simple_combobox_model.h"
#include "ui/base/page_transition_types.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/bubble/bubble_dialog_delegate_view.h"
#include "ui/views/controls/button/checkbox.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/combobox/combobox.h"
#include "ui/views/controls/label.h"
#include "ui/views/controls/textfield/textfield.h"
#include "ui/views/layout/box_layout.h"
#include "ui/views/widget/widget.h"
#include "url/gurl.h"

namespace aster {
namespace {
constexpr char kCatalogPref[] = "aster.workspace_catalog";
std::optional<WorkspaceCatalog> ReadCatalog(Profile* profile) {
  if (profile->IsOffTheRecord())
    return std::nullopt;
  const auto& encoded = profile->GetPrefs()->GetString(kCatalogPref);
  if (encoded.empty())
    return DefaultWorkspaces();
  if (encoded.size() > 6 * 1024 * 1024)
    return std::nullopt;
  std::string bytes;
  if (!base::Base64Decode(encoded, &bytes))
    return std::nullopt;
  return DecodeCatalog(bytes);
}
bool WriteCatalog(Profile* profile, const WorkspaceCatalog& catalog) {
  auto bytes = EncodeCatalog(catalog, profile->IsOffTheRecord());
  if (!bytes)
    return false;
  profile->GetPrefs()->SetString(kCatalogPref, base::Base64Encode(*bytes));
  return true;
}
std::vector<int> ActiveSplitIndices(TabStripModel* model) {
  if (model->active_index() < 0)
    return {};
  auto split = model->GetSplitForTab(model->active_index());
  std::vector<int> indices;
  if (split)
    for (int i = 0; i < model->count(); ++i)
      if (model->GetSplitForTab(i) == split)
        indices.push_back(i);
  return indices;
}
std::unique_ptr<ui::SimpleComboboxModel> ProviderModel() {
  std::vector<ui::SimpleComboboxModel::Item> items;
  for (const auto& provider : BuiltinProviders())
    items.emplace_back(base::UTF8ToUTF16(provider.name));
  items.emplace_back(u"Custom HTTPS template");
  return std::make_unique<ui::SimpleComboboxModel>(std::move(items));
}
views::Textfield* AddField(views::View* parent, std::u16string_view name) {
  parent->AddChildView(std::make_unique<views::Label>(std::u16string(name)));
  auto* field = parent->AddChildView(std::make_unique<views::Textfield>());
  field->GetViewAccessibility().SetName(std::u16string(name));
  return field;
}
class SplitSearchBubble : public views::BubbleDialogDelegate {
 public:
  SplitSearchBubble(views::View* anchor, BrowserWindowInterface* browser)
      : BubbleDialogDelegate(anchor, views::BubbleBorder::TOP_RIGHT),
        browser_(browser->GetWeakPtr()) {
    contents_ = SetContentsView(std::make_unique<views::View>());
    SetTitle(u"Split Search");
    SetShowCloseButton(true);
    SetButtonLabel(ui::mojom::DialogButton::kOk, u"Search");
    set_fixed_width(400);
    contents_->SetLayoutManager(std::make_unique<views::BoxLayout>(
        views::BoxLayout::Orientation::kVertical, gfx::Insets(), 8));
    query_ = AddField(contents_, u"Search query");
    contents_->AddChildView(
        std::make_unique<views::Label>(u"Left / top provider"));
    left_ = contents_->AddChildView(
        std::make_unique<views::Combobox>(ProviderModel()));
    left_->GetViewAccessibility().SetName(u"Left or top search provider");
    left_->SetSelectedIndex(0);
    left_custom_ = AddField(contents_, u"Custom left URL (use {query})");
    contents_->AddChildView(
        std::make_unique<views::Label>(u"Right / bottom provider"));
    right_ = contents_->AddChildView(
        std::make_unique<views::Combobox>(ProviderModel()));
    right_->GetViewAccessibility().SetName(u"Right or bottom search provider");
    right_->SetSelectedIndex(1);
    right_custom_ = AddField(contents_, u"Custom right URL (use {query})");
    sync_ = contents_->AddChildView(std::make_unique<views::Checkbox>(
        u"Update both panes when submitting a query"));
    sync_->SetChecked(true);
    reuse_ = contents_->AddChildView(std::make_unique<views::Checkbox>(
        u"Keep current tab when creating a new split"));
    stacked_ = contents_->AddChildView(
        std::make_unique<views::Checkbox>(u"Top / bottom layout"));
    contents_->AddChildView(std::make_unique<views::MdTextButton>(
        base::BindRepeating(&SplitSearchBubble::Swap, base::Unretained(this)),
        u"Swap current panes"));
    status_ = contents_->AddChildView(std::make_unique<views::Label>());
    status_->SetMultiLine(true);
    SetAcceptCallbackWithClose(base::BindRepeating(&SplitSearchBubble::Search,
                                                   base::Unretained(this)));
    SetInitiallyFocusedView(query_);
  }

 private:
  SearchProvider Provider(views::Combobox* box, views::Textfield* custom) {
    auto index = box->GetSelectedIndex().value_or(0);
    if (index < BuiltinProviders().size())
      return BuiltinProviders()[index];
    return {"custom", "Custom", base::UTF16ToUTF8(custom->GetText())};
  }
  bool Search() {
    if (!browser_)
      return true;
    SplitSearchRequest request;
    request.query = base::UTF16ToUTF8(query_->GetText());
    request.left = Provider(left_, left_custom_);
    request.right = Provider(right_, right_custom_);
    request.synchronize = sync_->GetChecked();
    request.reuse_current_tab = reuse_->GetChecked();
    request.stacked = stacked_->GetChecked();
    if (RunSplitSearch(browser_.get(), request))
      return true;
    status_->SetText(
        u"Enter a query and valid HTTPS templates with one {query} "
        u"placeholder.");
    SizeToContents();
    return false;
  }
  void Swap() {
    if (!browser_)
      return;
    auto* model = browser_->GetTabStripModel();
    if (model->active_index() < 0)
      return;
    auto split = model->GetSplitForTab(model->active_index());
    if (!split) {
      status_->SetText(u"Open a split first.");
      SizeToContents();
      return;
    }
    model->ReverseTabsInSplit(*split);
    auto index = left_->GetSelectedIndex();
    left_->SetSelectedIndex(right_->GetSelectedIndex());
    right_->SetSelectedIndex(index);
    std::u16string text(left_custom_->GetText());
    left_custom_->SetText(right_custom_->GetText());
    right_custom_->SetText(text);
  }
  raw_ptr<views::View> contents_ = nullptr;
  base::WeakPtr<BrowserWindowInterface> browser_;
  raw_ptr<views::Textfield> query_;
  raw_ptr<views::Combobox> left_;
  raw_ptr<views::Combobox> right_;
  raw_ptr<views::Textfield> left_custom_;
  raw_ptr<views::Textfield> right_custom_;
  raw_ptr<views::Checkbox> sync_;
  raw_ptr<views::Checkbox> reuse_;
  raw_ptr<views::Checkbox> stacked_;
  raw_ptr<views::Label> status_;
};

class WorkspacesBubble : public views::BubbleDialogDelegate {
 public:
  WorkspacesBubble(views::View* anchor, BrowserWindowInterface* browser)
      : BubbleDialogDelegate(anchor, views::BubbleBorder::TOP_RIGHT),
        browser_(browser->GetWeakPtr()) {
    contents_ = SetContentsView(std::make_unique<views::View>());
    SetTitle(u"Workspaces");
    SetShowCloseButton(true);
    SetButtons(static_cast<int>(ui::mojom::DialogButton::kNone));
    set_fixed_width(400);
    contents_->SetLayoutManager(std::make_unique<views::BoxLayout>(
        views::BoxLayout::Orientation::kVertical, gfx::Insets(), 8));
    auto* boundary = contents_->AddChildView(std::make_unique<views::Label>(
        u"Saved workspaces belong to this browser profile. Use separate "
        u"profiles for personal and business accounts."));
    boundary->SetMultiLine(true);
    chooser_ = contents_->AddChildView(std::make_unique<views::Combobox>());
    chooser_->GetViewAccessibility().SetName(u"Workspace");
    session_name_ = AddField(contents_, u"Session name");
    session_name_->SetText(u"Current session");
    contents_->AddChildView(std::make_unique<views::MdTextButton>(
        base::BindRepeating(&WorkspacesBubble::Save, base::Unretained(this)),
        u"Save current window"));
    contents_->AddChildView(std::make_unique<views::MdTextButton>(
        base::BindRepeating(&WorkspacesBubble::Restore, base::Unretained(this)),
        u"Open saved session as additional tabs"));
    new_name_ = AddField(contents_, u"New workspace name");
    contents_->AddChildView(std::make_unique<views::MdTextButton>(
        base::BindRepeating(&WorkspacesBubble::Create, base::Unretained(this)),
        u"Create workspace"));
    status_ = contents_->AddChildView(std::make_unique<views::Label>());
    status_->SetMultiLine(true);
    Reload();
  }

 private:
  void Status(std::u16string_view text) {
    status_->SetText(text);
    if (GetWidget())
      SizeToContents();
  }
  void Reload() {
    if (!browser_)
      return;
    auto catalog = ReadCatalog(browser_->GetProfile());
    if (!catalog) {
      Status(u"Saved data could not be read. It has not been overwritten.");
      return;
    }
    ids_.clear();
    std::vector<ui::SimpleComboboxModel::Item> items;
    std::size_t selected = 0;
    for (const auto& workspace : catalog->workspaces) {
      if (workspace.id == catalog->active_id)
        selected = ids_.size();
      ids_.push_back(workspace.id);
      items.emplace_back(base::UTF8ToUTF16(workspace.name));
    }
    chooser_->SetOwnedModel(
        std::make_unique<ui::SimpleComboboxModel>(std::move(items)));
    chooser_->SetSelectedIndex(selected);
  }
  std::string Selected() const {
    auto index = chooser_->GetSelectedIndex();
    return index && *index < ids_.size() ? ids_[*index] : std::string();
  }
  void Save() {
    if (!browser_)
      return;
    auto catalog = ReadCatalog(browser_->GetProfile());
    if (!catalog) {
      Status(u"Saved data could not be read. It has not been overwritten.");
      return;
    }
    auto* model = browser_->GetTabStripModel();
    SavedSession session;
    session.name = base::UTF16ToUTF8(session_name_->GetText());
    int skipped = 0;
    for (int i = 0; i < model->count(); ++i) {
      auto* contents = model->GetWebContentsAt(i);
      auto url = contents->GetLastCommittedURL().spec();
      if (!IsRestorableUrl(url)) {
        ++skipped;
        continue;
      }
      if (i == model->active_index())
        session.active_tab = session.tabs.size();
      std::string group;
      if (auto id = model->GetTabGroupForTab(i))
        group = base::UTF16ToUTF8(
            model->group_model()->GetTabGroup(*id)->visual_data()->title());
      session.tabs.push_back({url, base::UTF16ToUTF8(contents->GetTitle()),
                              group, model->IsTabPinned(i)});
    }
    if (session.tabs.empty()) {
      Status(u"There are no supported pages to save.");
      return;
    }
    catalog->active_id = Selected();
    if (!SaveSession(*catalog, Selected(), session) ||
        !WriteCatalog(browser_->GetProfile(), *catalog)) {
      Status(
          u"Could not save: check the name and session size (256 tabs "
          u"maximum).");
      return;
    }
    Status(skipped ? u"Saved. Internal, file, uncommitted, or unsupported "
                     u"pages were skipped."
                   : u"Session saved locally in this profile.");
  }
  void Restore() {
    if (!browser_)
      return;
    auto catalog = ReadCatalog(browser_->GetProfile());
    if (!catalog) {
      Status(u"Saved data could not be read.");
      return;
    }
    auto name = base::UTF16ToUTF8(session_name_->GetText());
    const SavedSession* session = nullptr;
    for (const auto& workspace : catalog->workspaces)
      if (workspace.id == Selected())
        for (const auto& saved : workspace.sessions)
          if (saved.name == name)
            session = &saved;
    if (!session) {
      Status(u"No saved session with this name in the selected workspace.");
      return;
    }
    auto* model = browser_->GetTabStripModel();
    std::map<std::string, std::vector<content::WebContents*>> groups;
    content::WebContents* active = nullptr;
    bool failed = false;
    for (std::size_t i = 0; i < session->tabs.size(); ++i) {
      const auto& tab = session->tabs[i];
      GURL url(tab.url);
      if (!url.is_valid()) {
        failed = true;
        continue;
      }
      auto* contents = chrome::AddAndReturnTabAt(browser_.get(), url, -1, false,
                                                 std::nullopt, tab.pinned);
      if (!contents) {
        failed = true;
        continue;
      }
      if (i == session->active_tab)
        active = contents;
      if (!tab.group.empty())
        groups[tab.group].push_back(contents);
    }
    for (const auto& [title, contents] : groups) {
      std::vector<int> indices;
      for (auto* tab : contents) {
        int i = model->GetIndexOfWebContents(tab);
        if (i >= 0)
          indices.push_back(i);
      }
      if (indices.empty())
        continue;
      std::sort(indices.begin(), indices.end());
      auto id = model->AddToNewGroup(indices);
      tab_groups::TabGroupVisualData data(base::UTF8ToUTF16(title),
                                          tab_groups::TabGroupColorId::kGrey);
      model->ChangeTabGroupVisuals(id, data);
    }
    if (active) {
      int index = model->GetIndexOfWebContents(active);
      if (index >= 0)
        model->ActivateTabAt(index);
    }
    Status(failed ? u"Some saved pages could not be opened."
                  : u"Saved pages opened. Your existing tabs remain open.");
  }
  void Create() {
    if (!browser_)
      return;
    auto catalog = ReadCatalog(browser_->GetProfile());
    if (!catalog) {
      Status(u"Saved data could not be read. It has not been overwritten.");
      return;
    }
    auto id = base::Uuid::GenerateRandomV4().AsLowercaseString();
    if (!AddWorkspace(*catalog, id, base::UTF16ToUTF8(new_name_->GetText()))) {
      Status(u"Use a name of 1–128 UTF-8 bytes. Maximum 64 workspaces.");
      return;
    }
    catalog->active_id = id;
    if (!WriteCatalog(browser_->GetProfile(), *catalog)) {
      Status(u"Could not save workspace.");
      return;
    }
    Reload();
    new_name_->SetText(u"");
    Status(u"Workspace created.");
  }
  raw_ptr<views::View> contents_ = nullptr;
  base::WeakPtr<BrowserWindowInterface> browser_;
  raw_ptr<views::Combobox> chooser_;
  raw_ptr<views::Textfield> session_name_;
  raw_ptr<views::Textfield> new_name_;
  raw_ptr<views::Label> status_;
  std::vector<std::string> ids_;
};

class AsterToolbarButton : public views::MdTextButton {
  METADATA_HEADER(AsterToolbarButton, views::MdTextButton)
 public:
  AsterToolbarButton(BrowserWindowInterface* browser, bool workspaces)
      : MdTextButton(base::BindRepeating(&AsterToolbarButton::Open,
                                         base::Unretained(this)),
                     workspaces ? u"Workspaces" : u"Split Search"),
        browser_(browser->GetWeakPtr()),
        workspaces_(workspaces) {
    if (workspaces && browser->GetProfile()->IsOffTheRecord()) {
      SetEnabled(false);
      SetTooltipText(u"Saved workspaces are unavailable in private browsing");
    }
  }

 private:
  void Open() {
    if (!browser_)
      return;
    if (bubble_widget_) {
      bubble_widget_->Activate();
      return;
    }
    if (workspaces_)
      bubble_delegate_ =
          std::make_unique<WorkspacesBubble>(this, browser_.get());
    else
      bubble_delegate_ =
          std::make_unique<SplitSearchBubble>(this, browser_.get());
    bubble_widget_ = views::BubbleDialogDelegate::CreateBubble(
        bubble_delegate_.get(),
        base::BindOnce(&AsterToolbarButton::Closed, base::Unretained(this)));
    bubble_widget_->Show();
  }
  void Closed(views::Widget::ClosedReason) {
    // Keep the delegate alive until the currently executing callback returns.
    // It is replaced on next open; the widget always dies before its delegate.
    bubble_widget_.reset();
  }
  base::WeakPtr<BrowserWindowInterface> browser_;
  bool workspaces_;
  std::unique_ptr<views::BubbleDialogDelegate> bubble_delegate_;
  std::unique_ptr<views::Widget> bubble_widget_;
};
BEGIN_METADATA(AsterToolbarButton)
END_METADATA
}  // namespace

bool RunSplitSearch(BrowserWindowInterface* browser,
                    const SplitSearchRequest& request) {
  if (!browser || !browser->GetTabStripModel())
    return false;
  auto left = SearchUrl(request.left, request.query);
  auto right = SearchUrl(request.right, request.query);
  if (!left || !right)
    return false;
  GURL urls[] = {GURL(*left), GURL(*right)};
  for (const auto& url : urls)
    if (!url.is_valid() || !url.SchemeIs("https") || url.has_username() ||
        url.has_password() || url.has_ref())
      return false;
  auto* model = browser->GetTabStripModel();
  const auto layout = request.stacked ? split_tabs::SplitTabLayout::kStacked
                                      : split_tabs::SplitTabLayout::kSideBySide;
  auto indices = ActiveSplitIndices(model);
  if (indices.size() == 2) {
    model->UpdateSplitLayout(*model->GetSplitForTab(indices[0]), layout);
    for (std::size_t i = 0; i < indices.size(); ++i) {
      if (!request.synchronize && indices[i] != model->active_index())
        continue;
      model->GetWebContentsAt(indices[i])
          ->GetController()
          .LoadURL(urls[i], content::Referrer(), ui::PAGE_TRANSITION_GENERATED,
                   std::string());
    }
    return true;
  }
  // Creation always creates a pair. Query synchronization governs subsequent
  // explicit submissions, never website forms or background page activity.
  auto* left_contents =
      request.reuse_current_tab ? model->GetActiveWebContents() : nullptr;
  if (!left_contents)
    left_contents = chrome::AddAndReturnTabAt(browser, urls[0], -1, true);
  if (!left_contents)
    return false;
  const int left_index = model->GetIndexOfWebContents(left_contents);
  if (left_index < 0)
    return false;
  auto* right_contents = chrome::AddAndReturnTabAt(
      browser, urls[1], left_index + 1, false,
      model->GetTabGroupForTab(left_index), model->IsTabPinned(left_index));
  if (!right_contents)
    return false;
  const int updated_left = model->GetIndexOfWebContents(left_contents);
  const int right_index = model->GetIndexOfWebContents(right_contents);
  if (updated_left < 0 || right_index < 0 || updated_left == right_index)
    return false;
  model->AddToNewSplit({updated_left, right_index},
                       split_tabs::SplitTabVisualData(layout),
                       split_tabs::SplitTabCreatedSource::kToolbarButton);
  model->ActivateTabAt(model->GetIndexOfWebContents(left_contents));
  return true;
}
std::unique_ptr<views::View> CreateSplitSearchButton(
    BrowserWindowInterface* browser) {
  return std::make_unique<AsterToolbarButton>(browser, false);
}
std::unique_ptr<views::View> CreateWorkspacesButton(
    BrowserWindowInterface* browser) {
  return std::make_unique<AsterToolbarButton>(browser, true);
}
}  // namespace aster
