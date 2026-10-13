import { Routes } from '@angular/router';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'DocuFlow · The private document workspace',
    loadComponent: () => import('./features/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: '',
    component: ShellComponent,
    children: [
  {
    path: 'dashboard',
    title: 'Dashboard · DocuFlow',
    loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'files',
    title: 'All Files · DocuFlow',
    loadComponent: () => import('./features/files/files.component').then((m) => m.FilesComponent),
    data: { mode: 'all' },
  },
  {
    path: 'files/:folderId',
    title: 'Folder · DocuFlow',
    loadComponent: () => import('./features/files/files.component').then((m) => m.FilesComponent),
    data: { mode: 'all' },
  },
  {
    path: 'recent',
    title: 'Recent · DocuFlow',
    loadComponent: () => import('./features/files/files.component').then((m) => m.FilesComponent),
    data: { mode: 'recent' },
  },
  {
    path: 'starred',
    title: 'Starred · DocuFlow',
    loadComponent: () => import('./features/files/files.component').then((m) => m.FilesComponent),
    data: { mode: 'starred' },
  },
  {
    path: 'trash',
    title: 'Trash · DocuFlow',
    loadComponent: () => import('./features/files/files.component').then((m) => m.FilesComponent),
    data: { mode: 'trash' },
  },
  {
    path: 'viewer/:id',
    title: 'Viewer · DocuFlow',
    loadComponent: () => import('./features/viewer/viewer.component').then((m) => m.ViewerComponent),
  },
  {
    path: 'editor',
    title: 'Editor · DocuFlow',
    loadComponent: () => import('./features/editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    path: 'editor/:id',
    title: 'Editor · DocuFlow',
    loadComponent: () => import('./features/editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    path: 'tools',
    title: 'PDF Tools · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/tools-home.component').then((m) => m.ToolsHomeComponent),
  },
  {
    path: 'tools/merge',
    title: 'Merge PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/merge.component').then((m) => m.MergeComponent),
  },
  {
    path: 'tools/split',
    title: 'Split PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/split.component').then((m) => m.SplitComponent),
  },
  {
    path: 'tools/organize',
    title: 'Organize PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/organize.component').then((m) => m.OrganizeComponent),
  },
  {
    path: 'tools/rotate',
    title: 'Rotate PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/rotate.component').then((m) => m.RotateComponent),
  },
  {
    path: 'tools/images-to-pdf',
    title: 'Images to PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/images-to-pdf.component').then((m) => m.ImagesToPdfComponent),
  },
  {
    path: 'tools/pdf-to-images',
    title: 'PDF to Images · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/pdf-to-images.component').then((m) => m.PdfToImagesComponent),
  },
  {
    path: 'tools/extract-text',
    title: 'PDF to Text · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/extract-text.component').then((m) => m.ExtractTextComponent),
  },
  {
    path: 'tools/watermark',
    title: 'Watermark PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/watermark.component').then((m) => m.WatermarkComponent),
  },
  {
    path: 'tools/page-numbers',
    title: 'Page Numbers · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/page-numbers.component').then((m) => m.PageNumbersComponent),
  },
  {
    path: 'tools/compress',
    title: 'Compress PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/compress.component').then((m) => m.CompressComponent),
  },
  {
    path: 'tools/protect',
    title: 'Protect PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/protect.component').then((m) => m.ProtectComponent),
  },
  {
    path: 'tools/pdf-to-word',
    title: 'PDF to Word · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/pdf-to-word.component').then((m) => m.PdfToWordComponent),
  },
  {
    path: 'tools/word-to-pdf',
    title: 'Word to PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/word-to-pdf.component').then((m) => m.WordToPdfComponent),
  },
  {
    path: 'tools/excel-to-pdf',
    title: 'Excel to PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/office-convert.component').then((m) => m.OfficeConvertComponent),
    data: { conv: 'excel-to-pdf' },
  },
  {
    path: 'tools/pdf-to-excel',
    title: 'PDF to Excel · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/office-convert.component').then((m) => m.OfficeConvertComponent),
    data: { conv: 'pdf-to-excel' },
  },
  {
    path: 'tools/ppt-to-pdf',
    title: 'PowerPoint to PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/office-convert.component').then((m) => m.OfficeConvertComponent),
    data: { conv: 'ppt-to-pdf' },
  },
  {
    path: 'tools/pdf-to-ppt',
    title: 'PDF to PowerPoint · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/office-convert.component').then((m) => m.OfficeConvertComponent),
    data: { conv: 'pdf-to-ppt' },
  },
  {
    path: 'tools/ocr',
    title: 'OCR scanned PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/office-convert.component').then((m) => m.OfficeConvertComponent),
    data: { conv: 'ocr' },
  },
  {
    path: 'tools/edit-sheet',
    title: 'Edit Spreadsheet · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/sheet-editor.component').then((m) => m.SheetEditorComponent),
  },
  {
    path: 'tools/edit-ppt',
    title: 'Edit Presentation · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/ppt-editor.component').then((m) => m.PptEditorComponent),
  },
  {
    path: 'tools/edit',
    title: 'Edit PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/edit/edit-pdf.component').then((m) => m.EditPdfComponent),
  },
  {
    path: 'tools/edit/:id',
    title: 'Edit PDF · DocuFlow',
    loadComponent: () => import('./features/pdf-tools/edit/edit-pdf.component').then((m) => m.EditPdfComponent),
  },
  {
    path: 'converters',
    title: 'Converters · DocuFlow',
    loadComponent: () => import('./features/converters/converters.component').then((m) => m.ConvertersComponent),
  },
  {
    path: 'image-tools',
    title: 'Image Tools · DocuFlow',
    loadComponent: () => import('./features/image-tools/image-tools.component').then((m) => m.ImageToolsComponent),
  },
  {
    path: 'settings',
    title: 'Settings · DocuFlow',
    loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
