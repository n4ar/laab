import SwiftRs
import Tauri
import UIKit
import WebKit
import os

private let log = Logger(subsystem: "app.laab.ios", category: "native-tabbar")

struct TabArgs: Decodable {
  let id: String
  let title: String
  /// SF Symbol names for the normal and selected states.
  let icon: String
  let selectedIcon: String?
  let badge: String?
}

/// A button in the vertical bar. Tabs are buttons with `selected` set.
struct SideButtonArgs: Decodable {
  let id: String
  let icon: String
  let selectedIcon: String?
  let selected: Bool?
  let badge: String?
}

/// What the vertical bar shows: glass groups under the status bar and at the
/// bottom, as the system arranges bar items there.
struct SideArgs: Decodable {
  let top: [[SideButtonArgs]]
  let bottom: [[SideButtonArgs]]
}

struct UpdateArgs: Decodable {
  let tabs: [TabArgs]
  let selected: String
  /// Hides both bars (a dialog is over the page, or nobody is signed in).
  let hidden: Bool
  /// Hides only the bottom tab bar (a chat is pushed over the list); the
  /// vertical bar stays and shows the chat's buttons.
  let bottomHidden: Bool?
  /// The bottom bar's left edge and width in web (CSS) pixels, which are
  /// points on iOS. Without them it spans the screen.
  let x: Double?
  let width: Double?
  let side: SideArgs?
}

/// LAAB's bars, drawn by UIKit over the webview.
///
/// Where iOS has a vertical bar (iOS 27.1, such as the iPhone Duo's cover
/// screen), the status bar stands in a column at one edge and bar items go
/// in that column. The system only moves the items of its own navigation and
/// tab bar controllers there, and the webview is in neither, so this draws
/// the column itself with Liquid Glass. Elsewhere it shows a `UITabBar` at the
/// bottom. The frontend hears `select` for tabs, `action` for column buttons,
/// `layout` when the mode changes and `hinge` as a foldable opens or closes.
class NativeTabbarPlugin: Plugin {
  private var bars: SystemBars?
  private var column: SideColumnView?
  private var last: UpdateArgs?
  private var reportedEdge: String?
  private var reportedFold: CGRect?

  @objc public func update(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpdateArgs.self)
    log.debug("update selected=\(args.selected, privacy: .public) hidden=\(args.hidden)")
    DispatchQueue.main.async {
      guard let root = self.manager.viewController?.view else {
        invoke.reject("no view to show the bars in")
        return
      }
      self.last = args
      self.apply(args, in: root)
      invoke.resolve(self.layoutInfo())
    }
  }

  private func apply(_ args: UpdateArgs, in root: UIView) {
    // The column only watches the vertical bar's edge, the fold and the
    // hinge now; the system draws the bars.
    let column = self.column ?? installColumn(in: root)
    column.show(nil, hidden: true)
    if bars == nil, let content = manager.viewController, let window = content.view.window {
      let bars = SystemBars(content: content, window: window)
      bars.onSelect = { [weak self] id in self?.trigger("select", data: ["id": id]) }
      bars.onAction = { [weak self] id in self?.trigger("action", data: ["id": id]) }
      self.bars = bars
    }
    bars?.update(args, vertical: column.edge != nil)
  }

  /// `edge` is "leading", "trailing" or nil; `fold` is the frame of the
  /// hinge while the device is partly open. `height` is 0: the system's tab
  /// bar is in the page's safe area.
  private func layoutInfo() -> JSObject {
    var info: JSObject = ["height": 0.0]
    if let edge = column?.edge { info["edge"] = edge }
    if let fold = column?.fold {
      info["fold"] = [
        "x": Double(fold.minX), "y": Double(fold.minY), "width": Double(fold.width), "height": Double(fold.height),
      ] as JSObject
    }
    return info
  }

  private func installColumn(in root: UIView) -> SideColumnView {
    let column = SideColumnView(frame: root.bounds)
    column.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    column.onTap = { [weak self] id in self?.trigger("action", data: ["id": id]) }
    // Folding, unfolding and rotating move or remove the vertical bar, and
    // half-opening the device adds the fold.
    column.onEdgeChange = { [weak self] in
      guard let self, let root = self.manager.viewController?.view, let args = self.last else { return }
      self.apply(args, in: root)
      let info = self.layoutInfo()
      let edge = info["edge"] as? String
      let fold = self.column?.fold
      if edge != self.reportedEdge || fold != self.reportedFold {
        self.reportedEdge = edge
        self.reportedFold = fold
        self.trigger("layout", data: info)
      }
    }
    if #available(iOS 27.1, *) {
      // The hinge's status and angle in degrees, which reveal a chat peeked
      // at from the cover screen. Devices without a hinge never call this.
      column.addInteraction(
        UIHingeInteraction { [weak self] _, update in
          guard let hinge = update.hinge else { return }
          let status: String =
            switch hinge.status {
            case .closed: "closed"
            case .partiallyOpen: "partial"
            case .fullyOpen: "open"
            default: "unknown"
            }
          let angle = Double(hinge.angle * 180 / .pi)
          log.debug("hinge \(status, privacy: .public) \(angle, privacy: .public)")
          self?.trigger("hinge", data: ["status": status, "angle": angle])
        })
    }
    root.addSubview(column)
    self.column = column
    reportedEdge = column.edge
    return column
  }
}

/// The vertical bar's column: glass capsules of buttons in the safe-area
/// inset that iOS reserves at the bar's edge. Touches elsewhere fall through
/// to the webview.
class SideColumnView: UIView {
  var onTap: ((String) -> Void)?
  var onEdgeChange: (() -> Void)?
  private var groups: [UIView] = []
  /// How many buttons each group in `groups` holds.
  private var counts: [Int] = []
  /// The button ids per group the column was built for, and the buttons.
  private var built: [[String]] = []
  private var buttons: [String: UIButton] = [:]
  /// Tab groups by their index in `groups`.
  private var tabGroups: [Int: TabGroupView] = [:]
  private var spec: SideArgs?
  private var knownEdge: String?
  private var knownFold: CGRect?

  private static let buttonSize: CGFloat = 48
  private static let spacing: CGFloat = 12

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    if #available(iOS 27.1, *) {
      registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge) {
        (view: SideColumnView, _: UITraitCollection) in
        view.edgeMayHaveChanged()
      }
    }
    knownEdge = edge
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  /// The vertical bar's edge, or nil when this screen has none.
  var edge: String? {
    if #available(iOS 27.1, *) {
      switch traitCollection.verticalBarEdge {
      case .leading: return "leading"
      case .trailing: return "trailing"
      default: return nil
      }
    }
    return nil
  }

  /// The active fold (a division region) in this view's coordinates, which
  /// are the webview's: present only while the device is partly open.
  var fold: CGRect? {
    if #available(iOS 27.1, *) {
      return reservedRegions(kind: .division).first?.frame
    }
    return nil
  }

  /// Rebuild only when the buttons change. Selection and badges change on
  /// every tap; rebuilding then would replace a button between touch down
  /// and touch up, and the tap would be lost.
  func show(_ spec: SideArgs?, hidden: Bool) {
    self.spec = spec
    let structure = (spec.map { ($0.top + $0.bottom).filter { !$0.isEmpty } } ?? []).map { $0.map(\.id) }
    let rebuilt = structure != built || groups.isEmpty != (edge == nil)
    if rebuilt {
      rebuild()
    } else {
      let flat = (spec.map { ($0.top + $0.bottom).filter { !$0.isEmpty } } ?? [])
      for (i, group) in flat.enumerated() {
        if let tabs = tabGroups[i] {
          tabs.update(group)
        } else {
          for item in group { if let button = buttons[item.id] { configure(button, with: item) } }
        }
      }
    }
    let visible = !hidden && spec != nil
    log.debug("show visible=\(visible) rebuilt=\(rebuilt)")
    UIView.animate(withDuration: 0.2, delay: 0, options: [.allowUserInteraction, .beginFromCurrentState]) {
      for g in self.groups { g.alpha = visible ? 1 : 0 }
    }
    for g in groups { g.isUserInteractionEnabled = visible }
  }

  private func edgeMayHaveChanged() {
    setNeedsLayout()
    if edge != knownEdge {
      knownEdge = edge
      onEdgeChange?()
    }
  }

  // UIKit runs this again when the regions read here change, so folding the
  // device lands here too.
  override func layoutSubviews() {
    super.layoutSubviews()
    if edge != knownEdge || fold != knownFold {
      knownEdge = edge
      knownFold = fold
      DispatchQueue.main.async { self.onEdgeChange?() }
    }
    place()
  }

  // Only the buttons take touches.
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }

  private func rebuild() {
    groups.forEach { $0.removeFromSuperview() }
    groups = []
    counts = []
    buttons = [:]
    tabGroups = [:]
    built = []
    guard let spec, edge != nil else { return }
    for group in spec.top + spec.bottom where !group.isEmpty {
      let view = makeGroup(group, index: groups.count)
      addSubview(view)
      groups.append(view)
      counts.append(group.count)
      built.append(group.map(\.id))
    }
    place()
  }

  /// Top groups stack down from under the status bar, bottom groups up from
  /// the bottom inset, centred in the column.
  private func place() {
    guard let spec, let edge else { return }
    let insets = safeAreaInsets
    let columnWidth = edge == "trailing" ? insets.right : insets.left
    let columnX = edge == "trailing" ? bounds.width - columnWidth : 0
    let midX = columnX + columnWidth / 2
    let size = SideColumnView.buttonSize
    let gap = SideColumnView.spacing

    // The vertical status bar and the camera cover parts of the column; the
    // groups go between them.
    var top = insets.top + gap
    var bottomLimit = bounds.height - max(insets.bottom, gap)
    if #available(iOS 27.1, *) {
      for region in reservedRegions(kind: .occlusion)
      where region.frame.maxX > columnX && region.frame.minX < columnX + columnWidth {
        if region.frame.midY < bounds.midY {
          top = max(top, region.frame.maxY + gap)
        } else {
          bottomLimit = min(bottomLimit, region.frame.minY - gap)
        }
      }
    }

    let topCount = spec.top.filter { !$0.isEmpty }.count
    var y = top
    for i in 0..<min(topCount, groups.count) {
      let h = CGFloat(counts[i]) * size
      groups[i].frame = CGRect(x: midX - size / 2, y: y, width: size, height: h)
      y += h + gap
    }
    var bottom = bottomLimit
    for i in (topCount..<groups.count).reversed() {
      let h = CGFloat(counts[i]) * size
      bottom -= h
      groups[i].frame = CGRect(x: midX - size / 2, y: bottom, width: size, height: h)
      bottom -= gap
    }
  }

  /// A capsule of Liquid Glass with the group's buttons stacked inside.
  private func makeGroup(_ buttons: [SideButtonArgs], index: Int) -> UIView {
    let glass: UIVisualEffectView
    if #available(iOS 26.0, *) {
      let effect = UIGlassEffect()
      effect.isInteractive = true
      glass = UIVisualEffectView(effect: effect)
      glass.cornerConfiguration = .capsule()
    } else {
      glass = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
      glass.layer.cornerRadius = SideColumnView.buttonSize / 2
      glass.clipsToBounds = true
    }
    // Tabs are one control, so a press can slide between them.
    let content: UIView
    if buttons.contains(where: { $0.selected != nil }) {
      let tabs = TabGroupView(items: buttons, size: SideColumnView.buttonSize)
      tabs.onSelect = { [weak self] id in
        log.debug("tap \(id, privacy: .public)")
        self?.onTap?(id)
      }
      tabGroups[index] = tabs
      content = tabs
    } else {
      let stack = UIStackView()
      stack.axis = .vertical
      stack.distribution = .fillEqually
      for b in buttons {
        stack.addArrangedSubview(makeButton(b))
      }
      content = stack
    }
    content.translatesAutoresizingMaskIntoConstraints = false
    glass.contentView.addSubview(content)
    NSLayoutConstraint.activate([
      content.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor),
      content.topAnchor.constraint(equalTo: glass.contentView.topAnchor),
      content.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor),
    ])
    return glass
  }

  private func makeButton(_ b: SideButtonArgs) -> UIView {
    let button = UIButton(configuration: .plain())
    let id = b.id
    button.addAction(
      UIAction { [weak self] _ in
        log.debug("tap \(id, privacy: .public)")
        self?.onTap?(id)
      }, for: .touchUpInside)
    button.accessibilityIdentifier = id
    buttons[id] = button
    configure(button, with: b)
    return button
  }

  private func configure(_ button: UIButton, with b: SideButtonArgs) {
    let selected = b.selected ?? false
    var config = UIButton.Configuration.plain()
    config.image = UIImage(systemName: selected ? (b.selectedIcon ?? b.icon) : b.icon)
    config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 19, weight: .medium)
    config.baseForegroundColor = .label
    config.cornerStyle = .capsule
    config.background.backgroundColor = selected ? UIColor.label.withAlphaComponent(0.12) : .clear
    button.configuration = config

    let badgeTag = 0xBAD6E
    let label = button.viewWithTag(badgeTag) as? UILabel ?? {
      let label = UILabel()
      label.tag = badgeTag
      label.font = .systemFont(ofSize: 11, weight: .bold)
      label.textColor = .white
      label.textAlignment = .center
      label.backgroundColor = .systemRed
      label.layer.cornerRadius = 8
      label.clipsToBounds = true
      label.isUserInteractionEnabled = false
      label.translatesAutoresizingMaskIntoConstraints = false
      button.addSubview(label)
      NSLayoutConstraint.activate([
        label.heightAnchor.constraint(equalToConstant: 16),
        label.widthAnchor.constraint(greaterThanOrEqualToConstant: 16),
        label.centerXAnchor.constraint(equalTo: button.centerXAnchor, constant: 11),
        label.centerYAnchor.constraint(equalTo: button.centerYAnchor, constant: -11),
      ])
      return label
    }()
    label.text = b.badge.map { " \($0) " }
    label.isHidden = b.badge == nil
  }
}

/// The tabs in the vertical bar, as one control: press a tab and slide, and
/// the selection lens follows the finger with a tick for each tab it passes,
/// as the system tab bar does. Letting go selects the tab under the finger;
/// letting go far to the side cancels.
final class TabGroupView: UIView {
  var onSelect: ((String) -> Void)?
  private var items: [SideButtonArgs]
  private let size: CGFloat
  private var icons: [UIImageView] = []
  private var badges: [UILabel] = []
  private let lens = UIView()
  private var dragIndex: Int?
  private let ticks = UISelectionFeedbackGenerator()

  init(items: [SideButtonArgs], size: CGFloat) {
    self.items = items
    self.size = size
    super.init(frame: .zero)
    lens.backgroundColor = UIColor.label.withAlphaComponent(0.12)
    lens.isUserInteractionEnabled = false
    addSubview(lens)
    for item in items {
      let icon = UIImageView()
      icon.contentMode = .center
      icon.tintColor = .label
      icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 19, weight: .medium)
      icon.accessibilityIdentifier = item.id
      addSubview(icon)
      icons.append(icon)
      let badge = UILabel()
      badge.font = .systemFont(ofSize: 11, weight: .bold)
      badge.textColor = .white
      badge.textAlignment = .center
      badge.backgroundColor = .systemRed
      badge.layer.cornerRadius = 8
      badge.clipsToBounds = true
      addSubview(badge)
      badges.append(badge)
    }
    let press = UILongPressGestureRecognizer(target: self, action: #selector(pressed(_:)))
    press.minimumPressDuration = 0
    press.allowableMovement = .greatestFiniteMagnitude
    addGestureRecognizer(press)
    refresh()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  func update(_ next: [SideButtonArgs]) {
    guard next.map(\.id) == items.map(\.id) else { return }
    items = next
    if dragIndex == nil { refresh() }
  }

  private var selectedIndex: Int? { items.firstIndex { $0.selected == true } }

  private func slot(_ i: Int) -> CGRect {
    CGRect(x: 0, y: CGFloat(i) * size, width: bounds.width, height: size)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    for (i, icon) in icons.enumerated() {
      icon.frame = slot(i)
      let badge = badges[i]
      let width = max(16, badge.intrinsicContentSize.width + 8)
      badge.frame = CGRect(x: slot(i).midX + 11 - width / 2, y: slot(i).midY - 19, width: width, height: 16)
    }
    placeLens(at: dragIndex ?? selectedIndex, lifted: dragIndex != nil, animated: false)
  }

  /// Icons filled for the highlighted tab, and badges.
  private func refresh() {
    let lit = dragIndex ?? selectedIndex
    for (i, item) in items.enumerated() {
      icons[i].image = UIImage(systemName: i == lit ? (item.selectedIcon ?? item.icon) : item.icon)
      badges[i].text = item.badge
      badges[i].isHidden = item.badge == nil
    }
    setNeedsLayout()
  }

  private func placeLens(at index: Int?, lifted: Bool, animated: Bool) {
    let change = {
      guard let index else {
        self.lens.alpha = 0
        return
      }
      self.lens.alpha = 1
      self.lens.transform = .identity
      self.lens.frame = self.slot(index).insetBy(dx: 2, dy: 2)
      self.lens.layer.cornerRadius = self.lens.frame.height / 2
      // Pressed, the lens grows a little, as the system's does.
      if lifted { self.lens.transform = CGAffineTransform(scaleX: 1.12, y: 1.12) }
    }
    if animated {
      UIView.animate(
        withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.75, initialSpringVelocity: 0,
        options: [.allowUserInteraction, .beginFromCurrentState], animations: change)
    } else {
      change()
    }
  }

  private func index(at point: CGPoint) -> Int {
    min(max(Int(point.y / size), 0), items.count - 1)
  }

  @objc private func pressed(_ press: UILongPressGestureRecognizer) {
    let point = press.location(in: self)
    let i = index(at: point)
    switch press.state {
    case .began:
      ticks.prepare()
      dragIndex = i
      refresh()
      placeLens(at: i, lifted: true, animated: true)
    case .changed:
      guard i != dragIndex else { return }
      dragIndex = i
      ticks.selectionChanged()
      refresh()
      placeLens(at: i, lifted: true, animated: true)
    case .ended:
      dragIndex = nil
      let away = abs(point.x - bounds.midX) > 80
      if !away {
        // Show the choice now; the frontend's update confirms it.
        items = items.enumerated().map { j, item in
          SideButtonArgs(
            id: item.id, icon: item.icon, selectedIcon: item.selectedIcon, selected: j == i, badge: item.badge)
        }
      }
      refresh()
      placeLens(at: selectedIndex, lifted: false, animated: true)
      if !away { onSelect?(items[i].id) }
    default:
      dragIndex = nil
      refresh()
      placeLens(at: selectedIndex, lifted: false, animated: true)
    }
  }
}

/// LAAB's bars as the system's own. Each tab is a navigation controller, and
/// Tauri's view controller moves into the selected one, so iOS draws the tab
/// bar and the chat's bar buttons itself: at the bottom and top, or in the
/// vertical bar where there is one (the iPhone Duo).
final class SystemBars: NSObject, UITabBarControllerDelegate {
  var onSelect: ((String) -> Void)?
  var onAction: ((String) -> Void)?
  private let tabs = UITabBarController()
  private let content: UIViewController
  private var ids: [String] = []

  init(content: UIViewController, window: UIWindow) {
    self.content = content
    super.init()
    tabs.delegate = self
    // LINE marks the selected tab black (white in dark mode), not blue.
    tabs.view.tintColor = .label
    window.rootViewController = tabs
  }

  func update(_ args: UpdateArgs, vertical: Bool) {
    setTabs(args.tabs)
    if let i = ids.firstIndex(of: args.selected), i != tabs.selectedIndex || content.parent == nil {
      tabs.selectedIndex = i
      embed()
    }
    guard let nav = tabs.selectedViewController as? UINavigationController, let host = nav.topViewController else {
      return
    }
    // The page draws its own headers; the navigation bar is only for the
    // buttons the vertical bar shows.
    let buttons = vertical && !args.hidden
    nav.setNavigationBarHidden(!buttons, animated: false)
    let tabIds = Set(ids.map { "tab:\($0)" })
    let top = (args.side?.top ?? []).filter { !$0.isEmpty }
    let bottom = (args.side?.bottom ?? []).filter { g in !g.isEmpty && !g.contains { tabIds.contains($0.id) } }
    host.navigationItem.leadingItemGroups = buttons ? top.map(group) : []
    host.navigationItem.trailingItemGroups = buttons ? bottom.map(group) : []
    let hideTabs = args.hidden || (args.bottomHidden ?? false)
    if #available(iOS 18.0, *) {
      tabs.setTabBarHidden(hideTabs, animated: true)
    } else {
      tabs.tabBar.isHidden = hideTabs
    }
  }

  private func setTabs(_ next: [TabArgs]) {
    if next.map(\.id) != ids {
      ids = next.map(\.id)
      tabs.setViewControllers(
        next.map { _ in
          let host = UIViewController()
          host.view.backgroundColor = .systemBackground
          return UINavigationController(rootViewController: host)
        }, animated: false)
    }
    for (vc, t) in zip(tabs.viewControllers ?? [], next) {
      vc.tabBarItem = UITabBarItem(
        title: t.title, image: UIImage(systemName: t.icon), selectedImage: UIImage(systemName: t.selectedIcon ?? t.icon))
      vc.tabBarItem.badgeValue = t.badge
    }
  }

  /// Tauri's page into the selected tab, filling it, under its bars.
  private func embed() {
    guard let host = (tabs.selectedViewController as? UINavigationController)?.viewControllers.first,
      content.parent !== host
    else { return }
    content.willMove(toParent: nil)
    content.view.removeFromSuperview()
    content.removeFromParent()
    host.addChild(content)
    content.view.frame = host.view.bounds
    content.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    host.view.addSubview(content.view)
    content.didMove(toParent: host)
  }

  func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
    let i = tabBarController.selectedIndex
    guard ids.indices.contains(i) else { return }
    embed()
    onSelect?(ids[i])
  }

  private static let titles = [
    "back": "กลับ", "search": "ค้นหาในแชท", "notes": "โน้ต", "more": "เพิ่มเติม", "compose": "ค้นหา",
  ]

  private func group(_ buttons: [SideButtonArgs]) -> UIBarButtonItemGroup {
    UIBarButtonItemGroup(
      barButtonItems: buttons.map { b in
        let item = UIBarButtonItem(
          title: Self.titles[b.id] ?? b.id, image: UIImage(systemName: b.icon),
          primaryAction: UIAction { [weak self] _ in self?.onAction?(b.id) })
        if #available(iOS 26.0, *), let badge = b.badge { item.badge = .string(badge) }
        return item
      }, representativeItem: nil)
  }
}

@_cdecl("init_plugin_native_tabbar")
public func initPlugin() -> Plugin {
  return NativeTabbarPlugin()
}
