import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'
import type { Floor, LayerType, Project } from '../types/planner'

export async function exportFloorPdf(options: {
  svg: SVGSVGElement
  project: Project
  floor: Floor
  visibleLayers: LayerType[]
}): Promise<Blob> {
  const { svg, project, floor, visibleLayers } = options
  const clone = svg.cloneNode(true) as SVGSVGElement

  clone.setAttribute('width', '1200')
  clone.setAttribute('height', '860')
  clone.style.background = '#f8f5ed'

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a3',
  })

  pdf.setFillColor('#f8f5ed')
  pdf.rect(0, 0, 1190, 842, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(24)
  pdf.text(project.name, 44, 42)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(13)
  pdf.text(`${floor.name} • ${floor.floorType} • layers: ${visibleLayers.join(', ')}`, 44, 66)

  await svg2pdf(clone, pdf, {
    x: 44,
    y: 92,
    width: 1080,
    height: 680,
  })

  return pdf.output('blob')
}
