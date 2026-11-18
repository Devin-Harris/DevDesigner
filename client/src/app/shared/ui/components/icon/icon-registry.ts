/**
 * Thin-stroke SVG icon registry (Lucide/Feather-style) for the DevDesigner design
 * system. Each entry is the INNER markup of a 24x24 `viewBox` icon; the wrapping
 * <svg> (fill:none, stroke:currentColor, round caps) is provided by IconComponent.
 *
 * Names mirror the Material icon names the app used previously (so call sites map
 * 1:1) plus a few design-specific tool glyphs. Keep paths simple and consistent:
 * 24x24 grid, ~1.7 stroke, rounded joins.
 */
export const ICON_PATHS: Record<string, string> = {
   // ---- navigation / chrome ----
   chevron_right: '<path d="M9 6l6 6-6 6"/>',
   chevron_left: '<path d="M15 6l-6 6 6 6"/>',
   chevron_down: '<path d="M6 9l6 6 6-6"/>',
   arrow_drop_down: '<path d="M7 10l5 5 5-5"/>',
   expand_more: '<path d="M6 9l6 6 6-6"/>',
   close: '<path d="M6 6l12 12M18 6L6 18"/>',
   add: '<path d="M12 5v14M5 12h14"/>',
   remove: '<path d="M5 12h14"/>',
   search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
   more_vert: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
   more_horiz: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
   menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
   folder_open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
   sort: '<path d="M7 5v14M7 19l-3-3M7 5l3 3M17 19V5M17 5l-3 3M17 19l3-3"/>',

   // ---- brand / account ----
   schema:
      '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/><path d="M11 7.5h4a2 2 0 0 1 2 2V13"/>',
   account_circle: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5a6 6 0 0 1 11 0"/>',
   login: '<path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5M10 17l5-5-5-5M15 12H3"/>',
   logout: '<path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5M17 17l5-5-5-5M22 12H9"/>',
   light_mode:
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
   dark_mode: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z"/>',

   // ---- history / view ----
   undo: '<path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-1"/>',
   redo: '<path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h1"/>',
   center_focus_strong:
      '<circle cx="12" cy="12" r="3"/><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>',
   home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9"/>',
   map: '<path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4z"/><path d="M9 4v13M15 7v13"/>',
   merge_cells:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v4M12 16v4M7 12h3.5M8.5 10l2 2-2 2M17 12h-3.5M15.5 10l-2 2 2 2"/>',
   split_cells:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M10 12H6M7.5 10l-2 2 2 2M14 12h4M16.5 10l2 2-2 2"/>',
   table_rows: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 14.5h18"/>',
   grid_4x4: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
   smart_guides:
      '<rect x="4" y="5" width="7" height="6" rx="1"/><rect x="13" y="13" width="7" height="6" rx="1"/><path d="M2 5h20M16.5 2v20" stroke-dasharray="2 2"/>',

   // ---- export ----
   ios_share: '<path d="M12 15V4M8.5 7.5L12 4l3.5 3.5M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6"/>',
   download: '<path d="M12 4v11M8 11l4 4 4-4M5 19h14"/>',
   upload: '<path d="M12 15V4M8 8l4-4 4 4M5 19h14"/>',
   cloud: '<path d="M7 18h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z"/>',
   cloud_off: '<path d="M9.5 6.5A6 6 0 0 1 17.7 10.06 4 4 0 0 1 19.6 17M17 18H7a4.5 4.5 0 0 1-.8-8.9M4 4l16 16"/>',
   sync: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.6M20 4v4.6h-4.6M20 12a8 8 0 0 1-13.7 5.7L4 15.4M4 20v-4.6h4.6"/>',
   data_object:
      '<path d="M8 4a3 3 0 0 0-3 3v2a2 2 0 0 1-2 2 2 2 0 0 1 2 2v2a3 3 0 0 0 3 3M16 4a3 3 0 0 1 3 3v2a2 2 0 0 0 2 2 2 2 0 0 0-2 2v2a3 3 0 0 1-3 3"/>',
   photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/>',
   image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/>',
   picture_as_pdf: '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/>',

   // ---- project / item actions ----
   warning: '<path d="M12 3.5L2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.5v.01"/>',
   edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/>',
   content_copy:
      '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
   delete:
      '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6"/>',
   archive:
      '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
   unarchive:
      '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M9 14l3-3 3 3M12 11v6"/>',
   drag_indicator:
      '<circle cx="9" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
   share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6"/>',

   // ---- tools (dock) ----
   cursor: '<path d="M5 3l6.5 16 2.4-6.6 6.6-2.4L5 3z"/>',
   near_me: '<path d="M5 3l6.5 16 2.4-6.6 6.6-2.4L5 3z"/>',
   pan: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5m0-1V4.5a1.5 1.5 0 0 1 3 0V10m0-1V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1.2a4 4 0 0 1-3.1-1.5L5 15l1-1a2 2 0 0 1 2 0z"/>',
   table_chart: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M9.5 9.5v10"/>',
   crop_square: '<rect x="4" y="5" width="16" height="14" rx="2.5"/>',
   rounded_corner:
      '<path d="M5 11V8a3 3 0 0 1 3-3h3"/><rect x="4" y="4" width="16" height="16" rx="4" opacity="0"/><rect x="4" y="4" width="16" height="16" rx="5"/>',
   circle: '<circle cx="12" cy="12" r="8"/>',
   diamond: '<path d="M12 3l9 9-9 9-9-9 9-9z"/>',
   trending_flat: '<path d="M4 12h15M14 7l5 5-5 5"/>',
   arrow_tool: '<path d="M5 19L19 5M11 5h8v8"/>',
   horizontal_rule: '<path d="M5 12h14"/>',
   line_tool: '<path d="M5 19L19 5"/>',
   gesture: '<path d="M4 16c2-6 6-10 12-14"/><path d="M15.5 5.5l3 3M5 19l1-4L16 5l3 3L9 18l-4 1z"/>',
   pen: '<path d="M15.5 5.5l3 3M5 19l1-4L16 5l3 3L9 18l-4 1z"/>',
   title: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
   text_tool: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
   sticky:
      '<path d="M5 4h14a1 1 0 0 1 1 1v9l-6 6H6a1 1 0 0 1-1-1V5a1 1 0 0 1 0-1z"/><path d="M20 14h-5a1 1 0 0 0-1 1v5"/>',
   template: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',

   // ---- element styling ----
   colorize: '<path d="M15 5l4 4M18 4l2 2a1.5 1.5 0 0 1 0 2l-2 2-4-4 2-2a1.5 1.5 0 0 1 2 0zM13 8L4 17v3h3l9-9"/>',
   contrast: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
   line_weight:
      '<path d="M4 6h16M4 12h16M4 18h16" stroke-width="1"/><path d="M4 12h16" stroke-width="2"/><path d="M4 18h16" stroke-width="3.2"/>',
   opacity: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M12 3v18" opacity="0"/>',
   auto_fix: '<path d="M5 19L17 7M14.5 4.5l5 5M6 4v3M4.5 5.5h3M19 15v3M17.5 16.5h3"/>',
   description:
      '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5zM14 3.5V8h4M9 12h6M9 15.5h6"/>',
   difference:
      '<path d="M9 3h8l3 3v11"/><rect x="4" y="7" width="12" height="14" rx="1.5"/><path d="M10 10v5M7.5 12.5h5M7.5 18h5"/>',
   fit_screen: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M9 10h6v4H9z"/>',
   code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14"/>',
   format_size: '<path d="M4 7V5h9v2M8.5 5v13M6.5 18h4M14 12v-1.5h6V12M17 10.5V18M15.5 18h3"/>',
   font_download: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8.5 16l3-8 3 8M9.4 13.5h4.2"/>',
   format_bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
   format_list_bulleted: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
   format_list_numbered:
      '<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.8 13.5a1.4 1.4 0 0 1 2.6.6c0 1-2.6 1.8-2.6 2.9h2.8"/>',
   format_underlined: '<path d="M7 5v7a5 5 0 0 0 10 0V5M5 20h14"/>',
   format_line_spacing: '<path d="M3 7l2-2 2 2M5 5v14M3 17l2 2 2-2M10 7h11M10 12h11M10 17h11"/>',
   wrap_text: '<path d="M4 6h16M4 12h12a3 3 0 0 1 0 6h-4M4 18h4M13 16l-2 2 2 2"/>',
   format_italic: '<path d="M10 5h7M7 19h7M14 5l-4 14"/>',
   format_align_left: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
   format_align_center: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
   format_align_right: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
   vertical_align_top: '<path d="M4 4h16M12 8v12M8 12l4-4 4 4"/>',
   vertical_align_center: '<path d="M4 12h16M12 4v5M12 15v5M9 7l3-3 3 3M9 17l3 3 3-3"/>',
   vertical_align_bottom: '<path d="M4 20h16M12 4v12M8 12l4 4 4-4"/>',
   flip_to_front: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 14V6a2 2 0 0 1 2-2h8"/>',
   flip_to_back: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M10 20h8a2 2 0 0 0 2-2v-8"/>',
   bring_forward: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 14V6a2 2 0 0 1 2-2h8"/>',
   send_backward: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M10 20h8a2 2 0 0 0 2-2v-8"/>',
   swap_horiz: '<path d="M7 8h13M16 4l4 4-4 4M17 16H4M8 12l-4 4 4 4"/>',
   curve: '<path d="M4 18C6 6 18 6 20 18"/>',
   timeline: '<path d="M4 14l5-5 4 4 7-7"/><circle cx="9" cy="9" r="1.4"/><circle cx="13" cy="13" r="1.4"/>',
   drag_handle: '<path d="M4 9h16M4 15h16"/>',

   // ---- alignment (distribute/align tables) ----
   align_horizontal_left: '<path d="M4 4v16M8 7h8v3H8zM8 14h5v3H8z"/>',
   align_horizontal_center: '<path d="M12 4v16M8 7h8v3H8zM9.5 14h5v3h-5z"/>',
   align_horizontal_right: '<path d="M20 4v16M8 7h8v3H8zM11 14h5v3h-5z"/>',
   align_vertical_top: '<path d="M4 4h16M7 8h3v8H7zM14 8h3v5h-3z"/>',
   align_vertical_center: '<path d="M4 12h16M7 8h3v8H7zM14 9.5h3v5h-3z"/>',
   align_vertical_bottom: '<path d="M4 20h16M7 8h3v8H7zM14 11h3v5h-3z"/>',
   horizontal_distribute: '<path d="M4 4v16M20 4v16M10 8h4v8h-4z"/>',
   vertical_distribute: '<path d="M4 4h16M4 20h16M8 10h8v4H8z"/>',

   // ---- relationships / connectors ----
   add_link: '<path d="M9 12h6M8 8H6a4 4 0 0 0 0 8h2M16 8h2a4 4 0 0 1 4 4M18 18v3M16.5 19.5h3" />',
   link_off: '<path d="M9 12h3M8 8H6a4 4 0 0 0-.5 8M16 16h2a4 4 0 0 0 3-6.6M4 4l16 16"/>',
   arrow_downward: '<path d="M12 4v15M6 13l6 6 6-6"/>',
   arrow_upward: '<path d="M12 20V5M6 11l6-6 6 6"/>',
   east: '<path d="M4 12h15M14 7l5 5-5 5"/>',
   play_arrow: '<path d="M7 5l11 7-11 7z"/>',
   play_circle: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z"/>',
   crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
   clip_shape: '<circle cx="12" cy="12" r="8"/><path d="M4 16l5-5 4 4 3-3 4 4"/>',
   clip_release:
      '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><path d="M8 16l3-3 2 2 3-3"/>',

   // ---- keys / flags (table) ----
   key: '<circle cx="8" cy="12" r="4"/><path d="M11.5 12H21l-2 2m2-2-2-2M8 12h.01"/>',
   link: '<path d="M9 12h6M8 8H6a4 4 0 0 0 0 8h2M16 8h2a4 4 0 0 1 0 8h-2"/>',

   // ---- misc used in dialogs / share ----
   check: '<path d="M5 12l5 5L20 7"/>',
   visibility: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
   visibility_off:
      '<path d="M3 3l18 18M10.6 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.4 6.5C3.8 8.3 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
   slideshow: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8M10.5 8.5l3.5 1.5-3.5 1.5z"/>',
   fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
   notes: '<path d="M5 4h14v16H5zM8.5 9h7M8.5 13h7M8.5 17h4"/>',
   edit_note: '<path d="M4 6h11M4 11h7M4 16h5M14 20l6-6-2.5-2.5-6 6V20z"/>',
   info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
   open_in_full: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
   arrow_back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
   grid_view:
      '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
   highlight: '<path d="M5 19h6M9 15l-2 4M14 4l6 6-8 8-6-6z"/>',
   eraser:
      '<path d="M8 20h12M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8l-3.5-3.5z"/><path d="M9 11l5 5"/>',
   keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
   lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
   desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
   accessibility: '<circle cx="12" cy="5" r="1.5"/><path d="M5 9h14M12 9v5l-3 6M12 14l3 6"/>',
   elbow: '<path d="M4 18h7V6h9"/><path d="M17 3l3 3-3 3"/>',
   push_pin: '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 14v6"/>',
   tune: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
};
