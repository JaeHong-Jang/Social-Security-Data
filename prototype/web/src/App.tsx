import { Route, Routes } from 'react-router-dom'
import Layout from './Layout'
import { ToastProvider } from './ui'
import Home from './Home'
import Queue from './Queue'
import Detail from './Detail'
import Reguide from './Reguide'
import Analyze from './Analyze'
import Records from './Records'
import DataDiag from './DataDiag'
import Rules from './Rules'

export default function App() {
  return (
    <ToastProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/case/:id" element={<Detail />} />
          <Route path="/case/:id/reguide" element={<Reguide />} />
          <Route path="/analyze" element={<Analyze />} />
          <Route path="/records" element={<Records />} />
          <Route path="/data" element={<DataDiag />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Layout>
    </ToastProvider>
  )
}
